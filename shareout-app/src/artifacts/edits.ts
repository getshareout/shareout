/**
 * POST /v1/artifacts/{id}/edits — change an artifact's files with small ops instead of
 * re-sending every file.
 *
 * The ops run on an in-memory copy of the newest version (`base_version` must be it);
 * if any op fails nothing is written. The result is published as the next version
 * through the shared publish pipeline (moderation, readiness, tests gate, knowledge
 * hooks), and files the ops leave alone keep their R2 objects: only changed files are
 * uploaded. MCP edit_artifact calls {@link editArtifact} in-process.
 */
import type { ArtifactType, AuthMethod, Env, FileEntry, ImportedSource, PWAConfig, Visibility } from '../types';
import type { AuthUser } from '../api-auth';
import { checkRateLimit, hasScope, incrementRateLimit } from '../api-auth';
import { withIdempotency } from '../idempotency';
import { resolveAllowOpen } from '../access/allow-open';
import { checkStorageQuota } from '../quota';
import { sha256 } from '../crypto-utils';
import { createLogger, logError } from '../logging';
import { isAllowedMime, isSafeAssetPath, mimeForPath, MAX_PUBLISH_FILE_BYTES, SAFE_PATH_RULE, showPath } from '../validation';
import { isSafePagePath } from '../serve/page-agent';
import { publishArtifact } from '../publish/publish-artifact';
import { VersionConflictError, type CarriedAsset } from '../publish/types';
import { rateLimitExceededResponse, storageLimitExceededResponse } from '../publish/limits';
import { requireRole } from './roles';
import { decodeText, isTextMime } from './files';
import { json } from './json-response';
import {
  applyOps, newPaths, parseOps, summarize, textsNeeded,
  type BaseFile, type EditError, type EditOp, type FileState,
} from './apply-ops';

/** Types whose files are plain text published as-is; skills and libraries carry sidecars an edit would not keep. */
const EDITABLE = new Set<string>(['html', 'markdown', 'csv', 'txt', 'json']);

const DOCS = '/v1/skill/api/artifacts.md';

function err(status: number, code: string, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ success: false, error, code, docs: DOCS, ...extra }, status);
}

function opError(e: EditError): Response {
  const { code, message, ...rest } = e;
  return err(code === 'INVALID_OPS' || code === 'INVALID_PATH' ? 400 : 422, code, message, rest);
}

function conflict(base: number, current: number): Response {
  return err(409, 'VERSION_CONFLICT', `Nothing was changed: the artifact is at version ${current}, not ${base}.`, {
    base_version: base,
    current_version: current,
    hint: `Read the files you change again at version ${current} (GET /v1/artifacts/{id}/files?version=${current}), then send the ops with base_version ${current}.`,
  });
}

/** Paths a write or rename creates must be safe and of a publishable type. */
function vetNewPaths(ops: EditOp[]): EditError | null {
  for (const path of newPaths(ops)) {
    const mime = mimeForPath(path);
    if (!isSafeAssetPath(path) || (mime === 'text/html' && !isSafePagePath(path))) {
      return { code: 'INVALID_PATH', message: `${showPath(path)} is not a safe file path. ${mime === 'text/html' ? 'Pages use letters, digits, spaces and . _ - ~ / only. ' : ''}${SAFE_PATH_RULE}`, path };
    }
    if (!isAllowedMime(mime)) return { code: 'INVALID_PATH', message: `${showPath(path)} is not a file type ShareOut publishes (${mime}).`, path };
  }
  return null;
}

async function loadTexts(env: Env, base: BaseFile[], paths: Set<string>): Promise<Response | null> {
  const failures = await Promise.all(base.filter((b) => paths.has(b.path)).map(async (b) => {
    if (!isTextMime(b.mime)) return null;
    const obj = await env.ARTIFACTS.get(b.r2Key);
    if (!obj) return err(500, 'FILE_UNREADABLE', `The stored bytes of "${b.path}" could not be read; nothing was changed.`, { path: b.path });
    try {
      b.text = decodeText(new Uint8Array(await obj.arrayBuffer()), true);
    } catch {
      return err(422, 'NOT_TEXT', `"${b.path}" is not valid UTF-8 text; replace it whole with write (encoding "base64").`, { path: b.path });
    }
    return null;
  }));
  return failures.find((f) => f !== null) ?? null;
}

function bytesOf(st: FileState): Uint8Array {
  return st.encoding === 'base64'
    ? Uint8Array.from(atob(st.content ?? ''), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(st.content ?? '');
}

/** New content identical to the file it came from is not a change: keep the stored object. */
async function dropNoopWrites(files: Map<string, FileState>): Promise<Response | null> {
  for (const [path, st] of files) {
    if (st.content === undefined) continue;
    const bytes = bytesOf(st);
    if (bytes.length > MAX_PUBLISH_FILE_BYTES) {
      return err(413, 'FILE_TOO_LARGE', `"${path}" would be ${bytes.length} bytes; one file can be at most ${MAX_PUBLISH_FILE_BYTES} bytes.`, { path });
    }
    if (st.base && (await sha256(bytes.buffer as ArrayBuffer)) === st.base.sha256) {
      files.set(path, { mime: st.mime, base: st.base, encoding: 'utf8', replacements: 0 });
    }
  }
  return null;
}

function parseJson<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

interface ArtifactRow {
  name: string;
  slug: string;
  display_slug: string | null;
  workspace_id: string | null;
  visibility: Visibility;
  auth_method: AuthMethod | null;
  artifact_type: string;
  type_metadata: string | null;
}

/** The edit itself, for the REST handler and MCP edit_artifact. `input` is the request body. */
export async function editArtifact(
  env: Env,
  user: AuthUser,
  artifactId: string,
  input: Record<string, unknown>,
  executionCtx?: ExecutionContext,
): Promise<Response> {
  if (!hasScope(user, 'artifacts:publish')) return err(403, 'INSUFFICIENT_SCOPE', 'Token missing artifacts:publish scope');
  const base = input.base_version;
  if (typeof base !== 'number' || !Number.isInteger(base) || base < 1) {
    return err(400, 'VALIDATION_ERROR', 'base_version is required: the version_no of the files you read.', { param: 'base_version' });
  }
  if (input.message !== undefined && input.message !== null && typeof input.message !== 'string') {
    return err(400, 'VALIDATION_ERROR', 'message must be a string.', { param: 'message' });
  }
  if (input.dry_run !== undefined && typeof input.dry_run !== 'boolean') {
    return err(400, 'VALIDATION_ERROR', 'dry_run must be a boolean.', { param: 'dry_run' });
  }
  const dryRun = input.dry_run === true;
  const parsed = parseOps(input.ops);
  if ('error' in parsed) return opError(parsed.error);
  const badPath = vetNewPaths(parsed.ops);
  if (badPath) return opError(badPath);

  const row = await env.DB.prepare(
    'SELECT name, slug, display_slug, workspace_id, visibility, auth_method, artifact_type, type_metadata FROM artifacts WHERE id = ? AND deleted_at IS NULL'
  ).bind(artifactId).first<ArtifactRow>();
  if (!row) return err(404, 'NOT_FOUND', 'Artifact not found');
  // A workspace Agent token edits only inside its own workspace, then by the same role rule as publish.
  if (user.service && row.workspace_id !== user.service.workspaceId) {
    return err(403, 'FORBIDDEN', 'This token belongs to another workspace.');
  }
  if (await requireRole(env, artifactId, user.id, 'editor')) {
    return err(403, 'FORBIDDEN', 'You cannot edit this artifact.', { hint: 'Editing needs the owner or editor role on it.' });
  }
  const meta = parseJson<{ skill?: unknown; library?: unknown; source?: ImportedSource }>(row.type_metadata) ?? {};
  if (!EDITABLE.has(row.artifact_type) || meta.skill || meta.library) {
    return err(422, 'UNSUPPORTED_ARTIFACT_TYPE', `Edits work on html, markdown, csv, txt and json artifacts; this one is ${meta.skill ? 'a skill' : meta.library ? 'a library' : row.artifact_type}. Publish it whole with POST /v1/publish.`);
  }

  const head = await env.DB.prepare(
    'SELECT id, version_no, entrypoint, mobile_entrypoint FROM versions WHERE artifact_id = ? ORDER BY version_no DESC LIMIT 1'
  ).bind(artifactId).first<{ id: string; version_no: number; entrypoint: string; mobile_entrypoint: string | null }>();
  if (!head) return err(404, 'VERSION_NOT_FOUND', 'This artifact has no version to edit.');
  if (base !== head.version_no) return conflict(base, head.version_no);

  const rate = dryRun ? null : await checkRateLimit(env, user.id, 'publish', user.email);
  if (rate && !rate.allowed) return rateLimitExceededResponse(rate.reset);

  const { results } = await env.DB.prepare('SELECT path, r2_key, mime, size_bytes, sha256 FROM assets WHERE version_id = ?')
    .bind(head.id).all<{ path: string; r2_key: string; mime: string; size_bytes: number; sha256: string }>();
  const baseFiles: BaseFile[] = (results ?? []).map((a) => ({ path: a.path, mime: a.mime, size: a.size_bytes, sha256: a.sha256, r2Key: a.r2_key }));

  const unreadable = await loadTexts(env, baseFiles, textsNeeded(parsed.ops, baseFiles.map((b) => b.path)));
  if (unreadable) return unreadable;
  const applied = applyOps(baseFiles, head.entrypoint, parsed.ops);
  if (!applied.ok) return opError(applied.error);
  const tooBig = await dropNoopWrites(applied.files);
  if (tooBig) return tooBig;

  const changes = summarize(baseFiles, applied.files);
  if (!changes.length) {
    return json({ unchanged: true, base_version: base, version: { version_no: base }, changes: [], message: 'The ops leave every file as it was; no version was created.' });
  }
  if (dryRun) {
    return json({ dry_run: true, base_version: base, would_create_version: base + 1, entrypoint: applied.entrypoint, changes });
  }

  const files: FileEntry[] = [];
  const carried: CarriedAsset[] = [];
  for (const [path, st] of applied.files) {
    if (st.content === undefined && st.base) carried.push({ path, r2Key: st.base.r2Key, mime: st.base.mime, size: st.base.size, sha256: st.base.sha256 });
    else files.push({ path, content: st.content ?? '', mime: st.mime, ...(st.encoding === 'base64' ? { encoding: 'base64' as const } : {}) });
  }

  const quota = await checkStorageQuota(env, user.id, files);
  if (!quota.allowed) return storageLimitExceededResponse(quota);

  const main = applied.files.get(applied.entrypoint);
  let mainText: string | undefined;
  if (main?.content === undefined && main?.base && isTextMime(main.base.mime)) {
    if (main.base.text === undefined) {
      const obj = await env.ARTIFACTS.get(main.base.r2Key);
      if (!obj) return err(500, 'FILE_UNREADABLE', `The stored bytes of "${main.base.path}" could not be read; nothing was changed.`, { path: main.base.path });
      main.base.text = decodeText(new Uint8Array(await obj.arrayBuffer()));
    }
    mainText = main.base.text;
  }

  const [presentation, allowOpen] = await Promise.all([
    env.DB.prepare('SELECT pwa_config FROM artifact_presentation WHERE artifact_id = ?').bind(artifactId).first<{ pwa_config: string | null }>(),
    row.visibility === 'public' ? resolveAllowOpen(env, user.id, row.workspace_id).then((open) => open && !!user.email) : Promise.resolve(false),
  ]);

  try {
    const result = await publishArtifact(env, user, {
      name: row.name,
      slug: row.display_slug ?? row.slug,
      entrypoint: applied.entrypoint,
      files,
      carried,
      mainText,
      visibility: row.visibility,
      allowOpen,
      authMethod: row.auth_method ?? 'google',
      shareWith: [],
      credentials: [],
      workspaceId: row.workspace_id,
      folderId: null,
      ...(head.mobile_entrypoint ? { mobileEntrypoint: head.mobile_entrypoint, keepsMobile: applied.files.has(head.mobile_entrypoint) } : {}),
      pwa: parseJson<PWAConfig>(presentation?.pwa_config ?? null),
      artifactType: row.artifact_type as ArtifactType,
      ...(meta.source ? { source: meta.source } : {}),
      message: typeof input.message === 'string' ? input.message : null,
      artifactId,
      expectedVersionNo: base + 1,
    }, executionCtx);
    await incrementRateLimit(env, user.id, 'publish', user.email);

    const now = await env.DB.prepare('SELECT visibility FROM artifacts WHERE id = ?').bind(artifactId).first<{ visibility: string }>();
    const visibility = now?.visibility ?? row.visibility;
    if (visibility !== row.visibility && !result.notice && !result.moderation) {
      result.notice = `The artifact was ${row.visibility}; it is ${visibility} after this edit.`;
    }
    const res = json({ ...result, visibility, base_version: base, changes }, 201);
    if (rate) {
      res.headers.set('X-RateLimit-Remaining', String(Math.max(0, rate.remaining - 1)));
      res.headers.set('X-RateLimit-Reset', String(rate.reset));
    }
    return res;
  } catch (e) {
    if (e instanceof VersionConflictError) return conflict(base, e.currentVersion);
    if (e instanceof Error && /UNIQUE constraint failed: versions/.test(e.message)) {
      const latest = await env.DB.prepare('SELECT MAX(version_no) AS v FROM versions WHERE artifact_id = ?').bind(artifactId).first<{ v: number }>();
      return conflict(base, latest?.v ?? base + 1);
    }
    if (e instanceof Error && e.message === 'FORBIDDEN') return err(403, 'FORBIDDEN', 'You cannot edit this artifact.');
    logError(createLogger(env, { scope: 'publish', event: 'edit.failed', artifact_id: artifactId }), 'artifact edit failed', e);
    return err(500, 'INTERNAL_ERROR', 'The edit could not be published; retry once with the same request.');
  }
}

export function handleEditArtifact(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string,
  executionCtx?: ExecutionContext,
): Promise<Response> {
  return withIdempotency(request, env, `${user.id}:${user.service?.tokenId ?? ''}:edits:${artifactId}`, async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return err(400, 'INVALID_JSON', 'Send a JSON object: { base_version, ops, message?, dry_run? }.');
    }
    return editArtifact(env, user, artifactId, body as Record<string, unknown>, executionCtx);
  });
}
