/**
 * GET /v1/artifacts/{id}/sources[?version=<no|id>][&page=<path>]
 *
 * What data a published page uses, where it comes from, how fresh it is and which
 * elements each source feeds. Derived from the published version (never the draft) plus
 * live server facts. Unknown or unauthorized artifacts are 404, like the page itself.
 *
 * Cost control: anonymous callers share a per-IP budget; the page scan is cached per
 * version (immutable, and only what the published files hold); the built answer is
 * cached for a minute per viewer class (named / scoped / public), so a cached answer
 * never crosses permission levels. Editor answers carry queries and connection ids and
 * editors are few: they are built every time and never stored.
 */
import type { Env } from '../types';
import type { FetchContext } from '../router/context';
import { jsonWithApiErrors, simpleApiError } from '../http/api-error';
import { deferWork, kvCacheGet } from '../kv-cache';
import { checkSlidingWindowRateLimit, rateLimitClientKey, rateLimitResponse } from '../rate-limit';
import { callerClass, loadProvenanceArtifact, resolveSourcesCaller, sourcesUser } from './access';
import { detectCodeRefs, mergeCodeRefs, scanPage, type CodeRefs, type PageScan } from './scan';
import { loadSourceFacts } from './facts';
import { buildSources } from './build';
import type { SourcesResponse } from './types';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_SCRIPT_BYTES = 512 * 1024;
const MAX_SCRIPTS = 8;
// Bump when the scan or response shape changes, so stale cache entries are never read.
const CACHE_VERSION = 1;
const RESPONSE_TTL_S = 60;
const SCAN_TTL_S = 7 * 86_400;
const MAX_KEY = 480;

interface VersionRow {
  id: string;
  version_no: number;
  entrypoint: string;
  manifest_json: string | null;
}

interface AssetRow {
  path: string;
  r2_key: string;
  mime: string;
  size_bytes: number;
}

const noStore = (res: Response) => {
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
};
const notFound = () => noStore(simpleApiError('Artifact not found', 'NOT_FOUND', 404));

export async function handleGetArtifactSources(ctx: FetchContext, artifactId: string): Promise<Response> {
  const { env, url, request } = ctx;
  const user = await sourcesUser(ctx);
  if (!user) {
    // Each miss reads R2 and several tables; a signed-out caller gets a per-IP budget.
    const defer = ctx.executionCtx ? (w: Promise<unknown>) => ctx.executionCtx!.waitUntil(w) : undefined;
    const limit = await checkSlidingWindowRateLimit(env.RATE_LIMIT_KV, rateLimitClientKey(request), 'sourcesAnon', defer);
    if (!limit.allowed) return noStore(rateLimitResponse(limit));
  }

  const art = await loadProvenanceArtifact(env, artifactId);
  if (!art) return notFound();
  const caller = await resolveSourcesCaller(ctx, art, user);
  if (!caller) return notFound();

  const versionParam = url.searchParams.get('version')?.trim() || '';
  if (versionParam && !caller.full) {
    return noStore(simpleApiError('Only editors can read the sources of another version', 'FORBIDDEN', 403));
  }
  const version = await loadVersion(env, artifactId, versionParam);
  if (!version) {
    return noStore(simpleApiError(versionParam ? 'Version not found' : 'This page has no published version', 'VERSION_NOT_FOUND', 404));
  }

  const page = url.searchParams.get('page')?.trim() || version.entrypoint;
  const responseKey = caller.full ? null : cacheKey('resp', artifactId, version.id, page, callerClass(caller));
  const cached = responseKey && env.SLUGS ? await kvCacheGet(env.SLUGS, responseKey) : null;
  if (cached) {
    return noStore(new Response(cached, { headers: { 'Content-Type': 'application/json' } }));
  }

  const assets = await loadAssets(env, version.id);
  const pageAsset = assets.find((a) => a.path === page);
  if (!pageAsset && page !== version.entrypoint) {
    return noStore(simpleApiError('No page with that path in this version', 'PAGE_NOT_FOUND', 404));
  }

  const scan = pageAsset ? await cachedScan(env, version.id, pageAsset, assets) : null;
  const facts = await loadSourceFacts(env, {
    artifactId,
    workspaceId: art.workspace_id,
    manifestJson: version.manifest_json,
    accessPolicy: art.access_policy,
    fileIds: scan ? [...scan.code.files] : [],
    withStamps: !caller.scoped,
  });
  const body: SourcesResponse = {
    artifact_id: artifactId,
    version: { ...(caller.full ? { id: version.id } : {}), number: version.version_no, page },
    access: caller.full ? 'full' : 'summary',
    scoped: caller.scoped,
    sources: buildSources(scan, facts, caller, { artifactId, workspaceId: art.workspace_id }),
  };
  const text = JSON.stringify(body);
  const kv = env.SLUGS;
  if (responseKey && kv) deferWork(() => kv.put(responseKey, text, { expirationTtl: RESPONSE_TTL_S }));
  return noStore(jsonWithApiErrors(body));
}

function cacheKey(kind: 'resp' | 'scan', ...parts: string[]): string | null {
  const key = `prov:v${CACHE_VERSION}:${kind}:${parts.map(encodeURIComponent).join(':')}`;
  return key.length <= MAX_KEY ? key : null;
}

async function loadVersion(env: Env, artifactId: string, param: string): Promise<VersionRow | null> {
  const cols = 'v.id, v.version_no, v.entrypoint, v.manifest_json';
  if (!param) {
    return env.DB.prepare(
      `SELECT ${cols} FROM deployments d JOIN versions v ON v.id = d.version_id
        WHERE d.artifact_id = ? AND d.channel = 'production'`,
    ).bind(artifactId).first<VersionRow>();
  }
  if (/^\d+$/.test(param)) {
    return env.DB.prepare(`SELECT ${cols} FROM versions v WHERE v.artifact_id = ? AND v.version_no = ?`)
      .bind(artifactId, Number(param)).first<VersionRow>();
  }
  return env.DB.prepare(`SELECT ${cols} FROM versions v WHERE v.artifact_id = ? AND v.id = ?`)
    .bind(artifactId, param).first<VersionRow>();
}

async function loadAssets(env: Env, versionId: string): Promise<AssetRow[]> {
  const rows = await env.DB.prepare(
    'SELECT path, r2_key, mime, size_bytes FROM assets WHERE version_id = ? LIMIT 500',
  ).bind(versionId).all<AssetRow>();
  return rows.results ?? [];
}

/** A version's files never change, so its scan is cached for a week. */
async function cachedScan(env: Env, versionId: string, page: AssetRow, assets: AssetRow[]): Promise<PageScan | null> {
  const key = cacheKey('scan', versionId, page.path);
  const kv = env.SLUGS;
  if (key && kv) {
    const hit = await kvCacheGet(kv, key);
    if (hit) {
      const scan = parseScan(hit);
      if (scan) return scan;
    }
  }
  const scan = await scanAsset(env, page, assets);
  if (scan && key && kv) {
    const text = stringifyScan(scan);
    deferWork(() => kv.put(key, text, { expirationTtl: SCAN_TTL_S }));
  }
  return scan;
}

async function scanAsset(env: Env, page: AssetRow, assets: AssetRow[]): Promise<PageScan | null> {
  if (!page.mime.startsWith('text/html') || page.size_bytes > MAX_HTML_BYTES) return null;
  const html = await readText(env, page.r2_key);
  if (html === null) return null;
  const scan = await scanPage(html, page.path);
  const scripts = await Promise.all(
    scan.scriptPaths
      .map((p) => assets.find((a) => a.path === p))
      .filter((a): a is AssetRow => !!a && /javascript|ecmascript/.test(a.mime) && a.size_bytes <= MAX_SCRIPT_BYTES)
      .slice(0, MAX_SCRIPTS)
      .map((a) => readText(env, a.r2_key)),
  );
  mergeCodeRefs(scan.code, detectCodeRefs(scripts.filter((s): s is string => s !== null)));
  return scan;
}

const SET_FIELDS = ['json', 'tables', 'connections', 'datasets', 'platforms', 'secrets', 'files'] as const;

export function stringifyScan(scan: PageScan): string {
  const code: Record<string, unknown> = { knowledge: scan.code.knowledge, blobs: scan.code.blobs };
  for (const f of SET_FIELDS) code[f] = [...scan.code[f]];
  return JSON.stringify({ ...scan, code, metricIds: [...scan.metricIds] });
}

export function parseScan(text: string): PageScan | null {
  try {
    const raw = JSON.parse(text) as Omit<PageScan, 'code' | 'metricIds'> & { code: Record<string, unknown>; metricIds: string[] };
    const code = { knowledge: !!raw.code.knowledge, blobs: !!raw.code.blobs } as CodeRefs;
    for (const f of SET_FIELDS) code[f] = new Set(Array.isArray(raw.code[f]) ? (raw.code[f] as string[]) : []);
    return { ...raw, code, metricIds: new Set(raw.metricIds ?? []) };
  } catch {
    return null;
  }
}

async function readText(env: Env, key: string): Promise<string | null> {
  const obj = await env.ARTIFACTS.get(key);
  return obj ? obj.text() : null;
}
