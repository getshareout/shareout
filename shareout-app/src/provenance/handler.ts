/**
 * GET /v1/artifacts/{id}/sources[?version=<no|id>][&page=<path>]
 *
 * What data a published page uses, where it comes from, how fresh it is and which
 * elements each source feeds. Derived from the published version (never the draft) plus
 * live server facts. Unknown or unauthorized artifacts are 404, like the page itself.
 */
import type { Env } from '../types';
import type { FetchContext } from '../router/context';
import { jsonWithApiErrors, simpleApiError } from '../http/api-error';
import { loadProvenanceArtifact, resolveSourcesCaller } from './access';
import { detectCodeRefs, mergeCodeRefs, scanPage, type PageScan } from './scan';
import { loadSourceFacts } from './facts';
import { buildSources } from './build';
import type { SourcesResponse } from './types';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_SCRIPT_BYTES = 512 * 1024;
const MAX_SCRIPTS = 8;

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
  const { env, url } = ctx;
  const art = await loadProvenanceArtifact(env, artifactId);
  if (!art) return notFound();
  const caller = await resolveSourcesCaller(ctx, art);
  if (!caller) return notFound();

  const versionParam = url.searchParams.get('version')?.trim() || '';
  if (versionParam && !caller.full) {
    return noStore(simpleApiError('Only editors can read the sources of another version', 'FORBIDDEN', 403));
  }
  const version = await loadVersion(env, artifactId, versionParam);
  if (!version) {
    return noStore(simpleApiError(versionParam ? 'Version not found' : 'This page has no published version', 'VERSION_NOT_FOUND', 404));
  }

  const assets = await loadAssets(env, version.id);
  const page = url.searchParams.get('page')?.trim() || version.entrypoint;
  const pageAsset = assets.find((a) => a.path === page);
  if (!pageAsset && page !== version.entrypoint) {
    return noStore(simpleApiError('No page with that path in this version', 'PAGE_NOT_FOUND', 404));
  }

  const scan = pageAsset ? await scanAsset(env, pageAsset, assets) : null;
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
  return noStore(jsonWithApiErrors(body));
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

async function readText(env: Env, key: string): Promise<string | null> {
  const obj = await env.ARTIFACTS.get(key);
  return obj ? obj.text() : null;
}
