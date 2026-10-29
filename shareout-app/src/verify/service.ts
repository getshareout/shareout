// Verify entry points shared by the REST routes and the MCP tool: who may verify, what
// is rendered, and where the result is kept. One call checks a version on desktop and
// phone (or, with no Browser Rendering binding, its source only) and stores the run.
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { hasScope } from '../api-auth';
import { requireRole } from '../artifacts/roles';
import { createAccessToken } from '../token';
import { generateId } from '../crypto-utils';
import { getPlatformOrigin } from '../config/origins';
import { normalizeVisibility } from '../visibility-config';
import { hasMcpCapability } from '../mcp-broker/capabilities';
import { artifactContentHost, getArtifactCspOrigin, getSandboxedCSP } from '../serve/security';
import { captureUrl } from '../screenshots';
import { captureOwnHosts } from '../screenshots/request-policy';
import { parseCsp } from '../screenshots/csp';
import { mintCaptureCredentials } from '../auth/capture-session';
import { checkVerifyLimit, incrementVerifyLimit } from './limits';
import { renderForVerify, type RenderPlan } from './run';
import { buildResult } from './report';
import { sourceIssues, type SourceFile } from './source-checks';
import { readLatestRun, readShot, saveRun, shotPath } from './store';
import type { ScreenshotInfo, VerifyIssue, VerifyResult, Viewport } from './types';
import { VIEWPORT_NAMES } from './types';

export interface VerifyInput {
  /** version_no to verify; the live version when omitted. */
  version?: number;
  viewports?: Viewport[];
  fullPage?: boolean;
  /** Verifying the live version also refreshes its thumbnail; the MCP tool opts out. Default true. */
  refreshThumbnail?: boolean;
  /**
   * The platform's own run (the build agent testing a page it just published), not the person's.
   * Not charged to their hourly verify quota: the daily publish cap already bounds how often it runs.
   */
  system?: boolean;
}

export interface VerifyFailure {
  ok: false;
  status: number;
  code: string;
  error: string;
  hint?: string;
  param?: string;
  /** Extra fields and headers for a 429. */
  limit?: { limit: number; reset: number };
}

export interface VerifyRun {
  ok: true;
  name: string;
  result: VerifyResult;
  shots: Partial<Record<Viewport, Uint8Array>>;
}

interface ArtifactRow {
  id: string;
  name: string;
  owner_id: string | null;
  workspace_id: string | null;
  visibility: string;
  paused: number;
  slug: string | null;
  live_version_id: string | null;
  moderation_status: string;
  has_mobile: number;
}

interface VersionRow {
  id: string;
  version_no: number;
  entrypoint: string;
  mobile_entrypoint: string | null;
  manifest_json: string | null;
}

interface AssetRow {
  path: string;
  r2_key: string;
  mime: string;
  size_bytes: number;
}

const MAX_SOURCE_FILES = 40;
const MAX_SOURCE_BYTES = 1_500_000;

const fail = (status: number, code: string, error: string, extra: Partial<VerifyFailure> = {}): VerifyFailure =>
  ({ ok: false, status, code, error, ...extra });

const NOT_FOUND = fail(404, 'NOT_FOUND', 'Artifact not found');

async function loadArtifact(env: Env, artifactId: string): Promise<ArtifactRow | null> {
  return env.DB.prepare(`
    SELECT a.id, a.name, a.owner_id, a.workspace_id, a.visibility, a.paused,
           d.slug AS slug, d.version_id AS live_version_id,
           COALESCE(m.status, 'approved') AS moderation_status,
           COALESCE(p.has_mobile, 0) AS has_mobile
      FROM artifacts a
      LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      LEFT JOIN artifact_moderation m ON m.artifact_id = a.id
      LEFT JOIN artifact_presentation p ON p.artifact_id = a.id
     WHERE a.id = ? AND a.deleted_at IS NULL
  `).bind(artifactId).first<ArtifactRow>();
}

/**
 * Verify results are for the people who can change the page: owners and editors. A
 * workspace Agent (`sot_`) token is held to its own workspace, and running a verify
 * needs artifacts:publish — it is part of the publish loop.
 */
async function authorize(env: Env, user: AuthUser, artifact: ArtifactRow, action: 'run' | 'read'): Promise<VerifyFailure | null> {
  if (user.service) {
    if (action === 'run' && !hasScope(user, 'artifacts:publish')) {
      return fail(403, 'INSUFFICIENT_SCOPE', 'Token missing artifacts:publish scope', {
        hint: 'Verifying is part of publishing: use a workspace Agent token with artifacts:publish, or a personal key.',
      });
    }
    if (user.service.externalUserId || artifact.workspace_id !== user.service.workspaceId) {
      return fail(403, 'FORBIDDEN', 'Forbidden');
    }
  }
  if (await requireRole(env, artifact.id, user.id, 'editor')) {
    return fail(403, 'FORBIDDEN', 'Only owners and editors of this page can verify it or read its results');
  }
  return null;
}

async function loadVersion(env: Env, artifact: ArtifactRow, versionNo?: number): Promise<VersionRow | null> {
  const cols = 'id, version_no, entrypoint, mobile_entrypoint, manifest_json';
  return versionNo === undefined
    ? env.DB.prepare(`SELECT ${cols} FROM versions WHERE id = ?`)
      .bind(artifact.live_version_id).first<VersionRow>()
    : env.DB.prepare(`SELECT ${cols} FROM versions WHERE artifact_id = ? AND version_no = ?`)
      .bind(artifact.id, versionNo).first<VersionRow>();
}

/**
 * The file a phone viewer of this version gets instead of the main entrypoint, or null —
 * the rule handleServe applies: the version has a mobile entrypoint (and, for the live
 * version, the artifact still serves it).
 */
function phoneEntrypoint(version: VersionRow, assets: AssetRow[], live: boolean, hasMobile: boolean): string | null {
  const path = version.mobile_entrypoint;
  return path && assets.some((a) => a.path === path) && (!live || hasMobile) ? path : null;
}

/** The version's own HTML/CSS/JS text, entrypoint first, bounded. */
async function readSources(env: Env, assets: AssetRow[], entrypoint: string): Promise<SourceFile[]> {
  const textual = assets
    .filter((a) => /^(text\/(html|css|javascript)|application\/(x-)?(javascript|ecmascript))/.test(a.mime) || /\.(html?|css|m?js)$/i.test(a.path))
    .sort((a, b) => (a.path === entrypoint ? -1 : b.path === entrypoint ? 1 : a.path.localeCompare(b.path)));
  const picked: AssetRow[] = [];
  let total = 0;
  for (const a of textual) {
    if (picked.length >= MAX_SOURCE_FILES || total + a.size_bytes > MAX_SOURCE_BYTES) continue;
    picked.push(a);
    total += a.size_bytes;
  }
  const files = await Promise.all(picked.map(async (a) => {
    const obj = await env.ARTIFACTS.get(a.r2_key);
    return obj ? { path: a.path, mime: a.mime, text: await obj.text() } : null;
  }));
  return files.filter((f): f is SourceFile => f !== null);
}

/**
 * What the browser opens: the capture view of this version on the artifact's own
 * content origin when the instance has one (a separate registrable domain — no app
 * cookies, no app pages), else the same-zone /a/{slug}/ path. Private pages get the
 * same short-lived content capability (`/c/<ct>/`) a viewer's iframe gets, so their
 * relative files load. The phone opens the mobile entrypoint when a phone viewer would
 * get it (`?v=mobile`). A pinned version, and a private page on a same-zone instance,
 * add the capture token (and the version) to the page's own file requests, so every
 * file comes from that version without a session cookie. The CSP enforced is the one
 * this page's viewers receive.
 */
async function renderPlan(
  env: Env,
  artifact: ArtifactRow & { slug: string },
  version: VersionRow,
  input: { viewports: Viewport[]; fullPage: boolean; live: boolean; isPublic: boolean; lockCsp: boolean; mobileEntry: string | null; refreshThumbnail: boolean },
): Promise<RenderPlan> {
  const platformOrigin = getPlatformOrigin(env);
  const host = artifactContentHost(env, artifact.id);
  let basePath = `/a/${artifact.slug}/`;
  let base = `${platformOrigin}${basePath}`;
  if (host) {
    const ct = input.isPublic ? '' : `c/${encodeURIComponent(await createAccessToken(artifact.id, 'content', env, 10 * 60))}/`;
    basePath = `/${ct}`;
    base = `https://${host}${basePath}`;
  }
  // A capture link (opens the capture view and, below, the page's own files — never a
  // data credential) and the read-only session the renderer attaches to this artifact's
  // data requests, both minted for one capture window (auth/capture-session.ts).
  const { link, session } = await mintCaptureCredentials(env, artifact.id);
  const url = captureUrl(link, base, input.live ? undefined : version.id);
  const pageOrigin = new URL(url).origin;
  const fileQuery = new URLSearchParams();
  if (!input.live || (!host && !input.isPublic)) fileQuery.set('_capture', link);
  if (!input.live) fileQuery.set('_ver', version.id);
  return {
    artifactId: artifact.id,
    targets: {
      desktop: { url, entrypoint: version.entrypoint },
      mobile: input.mobileEntry
        ? { url: `${url}&v=mobile`, entrypoint: input.mobileEntry }
        : { url, entrypoint: version.entrypoint },
    },
    pageOrigin,
    basePath,
    platformOrigin,
    fileQuery: fileQuery.toString() || null,
    ownHosts: [...new Set([...captureOwnHosts(env), new URL(url).hostname.toLowerCase()])],
    csp: parseCsp(getSandboxedCSP(getArtifactCspOrigin(env), !input.isPublic, env, input.lockCsp)),
    dataSession: { token: session, artifactId: artifact.id, origin: platformOrigin },
    viewports: input.viewports,
    fullPage: input.fullPage,
    refreshThumbnail: input.refreshThumbnail && input.live && input.viewports.includes('desktop'),
  };
}

export async function runVerify(
  env: Env,
  user: AuthUser,
  artifactId: string,
  input: VerifyInput = {},
): Promise<VerifyRun | VerifyFailure> {
  const startedAt = Date.now();
  const artifact = await loadArtifact(env, artifactId);
  if (!artifact) return NOT_FOUND;
  const denied = await authorize(env, user, artifact, 'run');
  if (denied) return denied;
  if (!artifact.slug || !artifact.live_version_id) {
    return fail(409, 'NOT_PUBLISHED', 'This page has no published version to verify yet', { hint: 'Publish it first (POST /v1/publish), then verify.' });
  }
  if (artifact.paused === 1) return fail(409, 'ARTIFACT_PAUSED', 'This page is paused, so viewers cannot open it');
  if (artifact.moderation_status === 'blocked') return fail(409, 'ARTIFACT_BLOCKED', 'This page was taken down, so viewers cannot open it');

  const version = await loadVersion(env, artifact, input.version);
  if (!version) return fail(404, 'VERSION_NOT_FOUND', `Version ${input.version} of this page does not exist`, { param: 'version' });
  const { results: assets = [] } = await env.DB.prepare('SELECT path, r2_key, mime, size_bytes FROM assets WHERE version_id = ?')
    .bind(version.id).all<AssetRow>();
  const entry = assets.find((a) => a.path === version.entrypoint);
  if (!entry || entry.mime !== 'text/html') {
    return fail(400, 'VERIFY_UNSUPPORTED', 'Verify checks HTML pages; this version\'s main file is not HTML', { hint: 'Markdown, CSV and other file pages are rendered by ShareOut\'s own viewers.' });
  }

  const limit = input.system ? { allowed: true, limit: 0, reset: 0 } : await checkVerifyLimit(env, user.id, user.email);
  if (!limit.allowed) {
    return fail(429, 'RATE_LIMIT_EXCEEDED', `Verify limit reached (${limit.limit} runs per hour). It resets at ${new Date(limit.reset * 1000).toISOString().slice(11, 16)} UTC.`, {
      hint: 'Batch your fixes and verify once per change set.',
      limit: { limit: limit.limit, reset: limit.reset },
    });
  }
  if (!input.system) await incrementVerifyLimit(env, user.id, user.email);

  const isPublic = (normalizeVisibility(artifact.visibility) || 'public') === 'public';
  const lockCsp = hasMcpCapability(version.manifest_json);
  const live = version.id === artifact.live_version_id;
  const viewports = VIEWPORT_NAMES.filter((v) => !input.viewports || input.viewports.includes(v));
  const files = await readSources(env, assets, version.entrypoint);
  const found: VerifyIssue[] = sourceIssues(files, { env, isPublic });
  const mobileEntry = phoneEntrypoint(version, assets, live, artifact.has_mobile === 1);

  let outcome = null;
  let partialReason: 'no_browser' | 'render_failed' | undefined;
  if (!env.BROWSER) {
    partialReason = 'no_browser';
  } else {
    const plan = await renderPlan(env, { ...artifact, slug: artifact.slug }, version, {
      viewports, fullPage: input.fullPage === true, live, isPublic, lockCsp, mobileEntry, refreshThumbnail: input.refreshThumbnail !== false,
    });
    outcome = await renderForVerify(env, plan);
    if (!outcome) partialReason = 'render_failed';
  }

  const id = generateId('vfy');
  const shots: Partial<Record<Viewport, Uint8Array>> = {};
  const screenshots: Partial<Record<Viewport, ScreenshotInfo>> = {};
  for (const s of outcome?.signals ?? []) {
    if (!s.screenshot) continue;
    shots[s.viewport] = s.screenshot.bytes;
    screenshots[s.viewport] = {
      path: shotPath(artifact.id, id, s.viewport),
      width: s.screenshot.width,
      height: s.screenshot.height,
      full_page: s.screenshot.fullPage,
    };
  }
  const result = buildResult({
    id,
    artifactId: artifact.id,
    versionNo: version.version_no,
    versionId: version.id,
    live,
    signals: outcome?.signals ?? null,
    partialReason,
    sourceIssues: found,
    screenshots,
    thumbnailRefreshed: outcome?.thumbnailRefreshed ?? false,
    isPublic,
    lockCsp,
    startedAt,
  });
  await saveRun(env, result, shots);
  return { ok: true, name: artifact.name, result, shots };
}

export async function latestVerify(env: Env, user: AuthUser, artifactId: string): Promise<{ ok: true; result: VerifyResult } | VerifyFailure> {
  const artifact = await loadArtifact(env, artifactId);
  if (!artifact) return NOT_FOUND;
  const denied = await authorize(env, user, artifact, 'read');
  if (denied) return denied;
  const result = await readLatestRun(env, artifact.id);
  if (!result) return fail(404, 'NO_VERIFY_RUN', 'This page has not been verified yet', { hint: `POST /v1/artifacts/${artifact.id}/verify runs one.` });
  return { ok: true, result };
}

export async function verifyScreenshot(
  env: Env,
  user: AuthUser,
  artifactId: string,
  runId: string,
  viewport: Viewport,
): Promise<{ ok: true; body: R2ObjectBody } | VerifyFailure> {
  const artifact = await loadArtifact(env, artifactId);
  if (!artifact) return NOT_FOUND;
  const denied = await authorize(env, user, artifact, 'read');
  if (denied) return denied;
  const body = await readShot(env, artifact.id, runId, viewport);
  if (!body) return fail(404, 'NOT_FOUND', 'No such screenshot — only the latest verify run is kept');
  return { ok: true, body };
}

// Exposed for unit tests; not part of the request-handling surface.
export const _internal = { renderPlan, phoneEntrypoint };

/** The stored result with absolute screenshot URLs for `origin`. */
export function presentResult(result: VerifyResult, origin: string): VerifyResult & { viewports: Array<VerifyResult['viewports'][number] & { screenshot: (ScreenshotInfo & { url: string }) | null }> } {
  return {
    ...result,
    viewports: result.viewports.map((v) => ({
      ...v,
      screenshot: v.screenshot ? { ...v.screenshot, url: `${origin}${v.screenshot.path}` } : null,
    })),
  };
}
