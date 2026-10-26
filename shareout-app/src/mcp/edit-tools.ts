/**
 * read_artifact / edit_artifact: change a page in place instead of re-sending it.
 *
 * read_artifact lists a version's files (from D1 alone) or returns one file, paged by
 * character offset, so a file of any size comes back whole across calls. edit_artifact
 * runs the same ops as POST /v1/artifacts/{id}/edits, in-process as the caller.
 */
import { hasScope } from '../api-auth';
import { requireRole } from '../artifacts/roles';
import { decodeText, isTextMime, toBase64, versionHeads } from '../artifacts/files';
import { editArtifact } from '../artifacts/edits';
import { SOURCE_MAX_BYTES } from '../artifacts/versions';
import { MAX_OPS } from '../artifacts/apply-ops';
import { ON_FAILURE, fail, invalid, ok, readJson, str, type ToolDef } from './tool-kit';

const PAGE_DEFAULT = 100_000;

interface Asset { path: string; r2_key: string; mime: string; size_bytes: number; sha256: string }

const readArtifact: ToolDef = {
  name: 'read_artifact',
  title: 'Read a page\'s files',
  description: [
    'Reads the files of a page exactly as stored, for changing them with edit_artifact.',
    'Without path: the list of files of the newest version (path, type, size) and that version number — pass it to edit_artifact as base_version.',
    'With path: that file\'s content from offset, at most max_chars characters; when more follows, next_offset says where to continue. Nothing is ever cut silently.',
    'Binary files come as base64.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      path: { type: 'string', description: 'The file to read, e.g. "index.html" or "css/site.css". Omit to list the files.' },
      offset: { type: 'integer', minimum: 0, default: 0, description: 'Character to start at (next_offset of the previous call).' },
      max_chars: { type: 'integer', minimum: 1000, maximum: SOURCE_MAX_BYTES, default: PAGE_DEFAULT, description: 'Most characters to return in this call.' },
      version: { type: 'integer', minimum: 1, description: 'A specific version; defaults to the newest.' },
    },
    required: ['artifact_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const id = str(args.artifact_id, 100);
    if (!id) return fail('artifact_id is required.');
    const svc = ctx.user.service;
    if (svc && !hasScope(ctx.user, 'artifacts:read')) return invalid('This token lacks the artifacts:read scope.', { code: 'INSUFFICIENT_SCOPE' });
    const home = svc ? await ctx.env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?').bind(id).first<{ workspace_id: string | null }>() : null;
    if ((svc && home?.workspace_id !== svc.workspaceId) || await requireRole(ctx.env, id, ctx.user.id, 'viewer')) {
      return invalid('That page was not found, or the person cannot open it.');
    }
    const wanted = typeof args.version === 'number' ? args.version : null;
    const version = await ctx.env.DB.prepare(`
      SELECT v.id, v.version_no, v.entrypoint FROM versions v JOIN artifacts a ON a.id = v.artifact_id
      WHERE v.artifact_id = ? AND a.deleted_at IS NULL AND (? IS NULL OR v.version_no = ?)
      ORDER BY v.version_no DESC LIMIT 1
    `).bind(id, wanted, wanted).first<{ id: string; version_no: number; entrypoint: string }>();
    if (!version) return invalid(wanted ? `This page has no version ${wanted}.` : 'This page has no saved files.');
    const { results } = await ctx.env.DB.prepare('SELECT path, r2_key, mime, size_bytes, sha256 FROM assets WHERE version_id = ? ORDER BY path')
      .bind(version.id).all<Asset>();
    const assets = results ?? [];
    const path = typeof args.path === 'string' ? args.path : null;

    if (path === null) {
      const files = assets.map((a) => ({ path: a.path, mime: a.mime, size_bytes: a.size_bytes, sha256: a.sha256 }));
      const heads = await versionHeads(ctx.env, id);
      const notLive = heads.live_version !== null && heads.live_version !== heads.newest_version
        ? [`Version ${heads.newest_version} is saved but not live yet: people still see version ${heads.live_version}.`]
        : [];
      return ok([
        `Version ${version.version_no}${version.version_no === heads.newest_version ? ' (newest)' : ''}: ${files.length} ${files.length === 1 ? 'file' : 'files'}, main file ${version.entrypoint}.`,
        ...notLive,
        ...files.map((f) => `- ${f.path} (${f.mime}, ${f.size_bytes} bytes)`),
        `Read a file with path; change it with edit_artifact and base_version ${heads.newest_version ?? version.version_no} (the newest version).`,
      ].join('\n'), { artifact_id: id, version: version.version_no, ...heads, entrypoint: version.entrypoint, files });
    }

    const asset = assets.find((a) => a.path === path);
    if (!asset) return invalid(`Version ${version.version_no} has no file "${path}". Call read_artifact without path to list its files.`);
    const obj = await ctx.env.ARTIFACTS.get(asset.r2_key);
    if (!obj) return fail(`The stored content of "${path}" could not be read.`);
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const text = isTextMime(asset.mime);
    const full = text ? decodeText(bytes) : toBase64(bytes);
    const offset = typeof args.offset === 'number' ? args.offset : 0;
    if (offset > full.length) return invalid(`offset ${offset} is past the end: "${path}" has ${full.length} characters.`);
    if (!text && offset % 4) return invalid('For a base64 file, offset must be a multiple of 4 (use next_offset).');
    const max = typeof args.max_chars === 'number' ? args.max_chars : PAGE_DEFAULT;
    let end = Math.min(full.length, offset + (text ? max : max - (max % 4)));
    // Never split a surrogate pair (emoji and other characters outside the BMP).
    if (end < full.length && end > offset && /[\uD800-\uDBFF]/.test(full[end - 1])) end--;
    const content = full.slice(offset, end);
    const next = end < full.length ? end : null;
    return ok([
      `=== ${path} (${asset.mime}, ${asset.size_bytes} bytes${text ? '' : ', base64'}) version ${version.version_no}, characters ${offset}–${end} of ${full.length} ===`,
      content,
      next === null ? '=== end of file ===' : `=== more follows: call read_artifact with path "${path}" and offset ${next} ===`,
    ].join('\n'), {
      artifact_id: id, version: version.version_no, path, mime: asset.mime, encoding: text ? 'utf8' : 'base64',
      size_bytes: asset.size_bytes, sha256: asset.sha256, total_chars: full.length, offset, next_offset: next, content,
    });
  },
};

const OP_SCHEMA = {
  type: 'object',
  description: 'replace {path, old, new, all?}: old must match exactly once (all: true changes every match); text is literal. write {path, content, encoding?}: create or replace a whole file. delete {path}. rename {from, to}.',
  properties: {
    op: { type: 'string', enum: ['replace', 'write', 'delete', 'rename'] },
    path: { type: 'string' },
    old: { type: 'string', description: 'replace: the exact text to find, copied from the file, with enough around it to be unique.' },
    new: { type: 'string', description: 'replace: the text to put instead.' },
    all: { type: 'boolean', description: 'replace: change every match instead of requiring one.' },
    content: { type: 'string', description: 'write: the whole file.' },
    encoding: { type: 'string', enum: ['utf8', 'base64'] },
    from: { type: 'string', description: 'rename: current path.' },
    to: { type: 'string', description: 'rename: new path.' },
  },
  required: ['op'],
  additionalProperties: false,
};

type Change = { path: string; change: string; from?: string; replacements?: number };

const describeChange = (c: Change) =>
  `- ${c.path}: ${c.change}${c.from ? ` from ${c.from}` : ''}${c.replacements ? ` (${c.replacements} ${c.replacements === 1 ? 'replacement' : 'replacements'})` : ''}`;

const editArtifactTool: ToolDef = {
  name: 'edit_artifact',
  title: 'Edit a page',
  description: [
    'Changes part of a page the person already has, without sending the whole page: replace text, write, delete or rename files. Saves a new version at the same link.',
    'Read the files first with read_artifact and pass the version it reports as base_version; if the page changed since, nothing is changed and you are told the current version.',
    `ops run in order (at most ${MAX_OPS}); if any fails, nothing is saved and the error says which op and why (no match: the closest line; several matches: their lines).`,
    'dry_run: true shows what would change without saving.',
    'message: optional one-line note on what changed, shown in the page history.',
    'Afterwards give the person the link.',
    ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      base_version: { type: 'integer', minimum: 1, description: 'The version read_artifact reported.' },
      ops: { type: 'array', items: OP_SCHEMA },
      message: { type: 'string', description: 'A short note on what changed.' },
      dry_run: { type: 'boolean', default: false },
    },
    required: ['artifact_id', 'base_version', 'ops'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async run(ctx, args) {
    const id = str(args.artifact_id, 100);
    if (!id) return fail('artifact_id is needed.');
    const res = await editArtifact(ctx.env, ctx.user, id, {
      base_version: args.base_version,
      ops: args.ops,
      ...(str(args.message, 500) ? { message: str(args.message, 500) } : {}),
      ...(args.dry_run === true ? { dry_run: true } : {}),
    }, ctx.executionCtx);
    const body = await readJson(res);
    const changes = (Array.isArray(body.changes) ? body.changes : []) as Change[];

    if (res.status >= 500) return fail(`The page was not changed: ${String(body.error ?? res.status)}`, { status: res.status, code: body.code });
    if (res.status >= 400) {
      const { success: _s, error, docs: _d, request_id: _r, ...details } = body;
      const retry = body.code === 'VERSION_CONFLICT'
        ? ` Read the files you change again with read_artifact (version ${String(body.current_version)}) and send the ops with base_version ${String(body.current_version)}.`
        : '';
      return invalid(`Nothing was changed: ${String(error ?? `request failed (${res.status})`)}${retry}`, { status: res.status, ...details });
    }
    if (body.unchanged) return ok(`Nothing to save: the ops leave every file as it was (still version ${String(args.base_version)}).`, body);
    if (body.dry_run) {
      return ok([`Dry run, nothing saved. On version ${String(body.base_version)} these ops would create version ${String(body.would_create_version)}:`, ...changes.map(describeChange)].join('\n'), body);
    }

    const deployment = (body.deployment ?? {}) as Record<string, string>;
    const url = deployment.subdomain_url || deployment.url;
    const version = (body.version as { version_no?: number } | undefined)?.version_no;
    const notes: string[] = [];
    const moderation = body.moderation as { message?: string } | undefined;
    if (moderation?.message) notes.push(moderation.message);
    if (typeof body.notice === 'string') notes.push(body.notice);
    if (Array.isArray(body.warnings)) notes.push(...body.warnings.map(String));
    return ok([
      `Saved version ${version} (from ${String(body.base_version)}).`,
      `Link: ${url}`,
      'Changed:',
      ...changes.map(describeChange),
      ...(notes.length ? ['Tell the person:', ...notes.map((n) => `- ${n}`)] : []),
      'Give the person the link.',
    ].join('\n'), {
      url, artifact_id: id, version, base_version: body.base_version, visibility: body.visibility, changes, notices: notes,
    });
  },
};

export const EDIT_TOOLS: ToolDef[] = [readArtifact, editArtifactTool];

/** The only MCP tools a workspace Agent token may call: they enforce its scopes and workspace. */
export const AGENT_TOKEN_TOOLS: ReadonlySet<string> = new Set(EDIT_TOOLS.map((t) => t.name));
