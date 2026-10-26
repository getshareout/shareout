// One-click export — "your data is yours". Bundles an artifact (or a whole
// workspace) into a zip: published source files from R2, all MiniDB json keys
// (.json) and tables (.csv), and a manifest. No lock-in.
import { zipSync } from 'fflate';
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { createMiniDb } from '../data/minidb-client';
import { json } from './json-response';

// ponytail: flat cap on workspace exports — a zip is built fully in memory, so an
// unbounded workspace would blow the Worker's RAM. Bump / stream to R2 if a real
// tenant hits this.
const MAX_WORKSPACE_ARTIFACTS = 200;

type ZipEntries = Record<string, Uint8Array>;

interface ArtifactRow {
  id: string;
  name: string;
  slug: string;
  owner_id: string | null;
  workspace_id: string | null;
}

const enc = new TextEncoder();

/** Path segment safe for a zip entry: no separators, no leading dots. */
function safeName(s: string): string {
  return (s.replace(/[/\\]+/g, '_').replace(/^\.+/, '_').trim() || 'unnamed').slice(0, 120);
}

// Zip entry names for stored asset paths. Paths written before `isSafeAssetPath` was
// enforced can hold `\`, `..`, control characters or empty segments; written verbatim a
// Windows unzip could land them outside its folder (zip-slip).
const MAX_SEGMENT = 255;
const MAX_PATH = 512;
const WIN_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;

function clip(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  const dot = s.lastIndexOf('.');
  const ext = dot > 0 && s.length - dot <= 16 ? Array.from(s.slice(dot)) : [];
  return chars.slice(0, max - ext.length).join('') + ext.join('');
}

function cleanSegments(path: string): string[] {
  return path.split('/')
    .map((seg) => clip(seg, MAX_SEGMENT).replace(/[. ]+$/, ''))
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..')
    .map((seg) => (WIN_RESERVED_NAME.test(seg) ? `_${seg}` : seg));
}

/** One stored path → a relative zip-safe path (safe paths come back unchanged). */
export function exportPath(path: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = path.replace(/\\/g, '/').replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*]/g, '');
  let segs = cleanSegments(stripped);
  if (segs.join('/').length > MAX_PATH) segs = cleanSegments(clip(segs.join('/'), MAX_PATH));
  return segs.join('/') || 'unnamed';
}

/** Zip-safe, unique names for a version's paths, plus the renames (original → exported). */
export function exportPaths(paths: string[]): { names: string[]; renamed: [string, string][] } {
  const clean = paths.map(exportPath);
  // Unchanged paths claim their names first, so a safe path is never the one renamed.
  const used = new Set(paths.filter((p, i) => clean[i] === p));
  const taken = new Set<string>();
  const renamed: [string, string][] = [];
  const names = paths.map((p, i) => {
    const base = clean[i];
    if (base === p && !taken.has(base)) { taken.add(base); return base; }
    const dot = base.lastIndexOf('.');
    const cut = dot > base.lastIndexOf('/') + 1 ? dot : base.length;
    let name = base;
    for (let n = 2; used.has(name) || taken.has(name); n++) name = `${base.slice(0, cut)}~${n}${base.slice(cut)}`;
    used.add(name);
    taken.add(name);
    renamed.push([p, name]);
    return name;
  });
  return { names, renamed };
}

function renamedManifest(renamed: [string, string][]): string {
  return [
    'Some stored file paths were not safe to unzip as-is and were renamed in source/:',
    '',
    ...renamed.map(([from, to]) => `${JSON.stringify(from)} → ${JSON.stringify(to)}`),
    '',
  ].join('\n');
}

/** RFC-4180-ish CSV cell: quote when it contains a comma, quote, or newline. */
function csvCell(v: unknown): string {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Resolve the production version's source files and version number. */
async function loadSourceFiles(env: Env, artifactId: string): Promise<{ versionNo: number | null; files: { path: string; bytes: Uint8Array }[] }> {
  const deployment = await env.DB.prepare(
    "SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = 'production'",
  ).bind(artifactId).first<{ version_id: string }>();
  if (!deployment) return { versionNo: null, files: [] };

  const version = await env.DB.prepare(
    'SELECT version_no FROM versions WHERE id = ?',
  ).bind(deployment.version_id).first<{ version_no: number }>();

  const assets = await env.DB.prepare(
    'SELECT path, r2_key FROM assets WHERE version_id = ?',
  ).bind(deployment.version_id).all<{ path: string; r2_key: string }>();

  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const asset of assets.results || []) {
    const obj = await env.ARTIFACTS.get(asset.r2_key);
    if (!obj) continue;
    files.push({ path: asset.path, bytes: new Uint8Array(await obj.arrayBuffer()) });
  }
  return { versionNo: version?.version_no ?? null, files };
}

/** Build zip entries for one artifact, under an optional folder prefix. */
async function collectArtifact(env: Env, artifact: ArtifactRow, prefix = ''): Promise<ZipEntries> {
  const entries: ZipEntries = {};
  const { versionNo, files } = await loadSourceFiles(env, artifact.id);

  const { names, renamed } = exportPaths(files.map((f) => f.path));
  files.forEach((f, i) => { entries[`${prefix}source/${names[i]}`] = f.bytes; });
  if (renamed.length) entries[`${prefix}RENAMED.txt`] = enc.encode(renamedManifest(renamed));

  const db = createMiniDb(env, artifact.id, artifact.workspace_id ?? '');

  const keys = await db.prepare(
    'SELECT key, value FROM artifact_json WHERE artifact_id = ? ORDER BY key',
  ).bind(artifact.id).all<{ key: string; value: string }>();
  for (const row of keys.results || []) {
    entries[`${prefix}data/json/${safeName(row.key)}.json`] = enc.encode(row.value);
  }

  const tables = await db.prepare(
    'SELECT id, name FROM artifact_tables WHERE artifact_id = ? ORDER BY name',
  ).bind(artifact.id).all<{ id: string; name: string }>();
  for (const table of tables.results || []) {
    const rows = await db.prepare(
      'SELECT data FROM artifact_rows WHERE table_id = ? ORDER BY created_at',
    ).bind(table.id).all<{ data: string }>();
    entries[`${prefix}data/tables/${safeName(table.name)}.csv`] = enc.encode(rowsToCsv(rows.results || []));
  }

  const manifest = {
    id: artifact.id,
    title: artifact.name,
    slug: artifact.slug,
    version: versionNo,
    exported_at: new Date().toISOString(),
  };
  entries[`${prefix}manifest.json`] = enc.encode(JSON.stringify(manifest, null, 2));

  return entries;
}

/** Flatten JSON row objects to a CSV with a column union (first-seen order). */
function rowsToCsv(rows: { data: string }[]): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  const parsed: Record<string, unknown>[] = [];
  for (const row of rows) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    parsed.push(obj);
    for (const k of Object.keys(obj)) {
      if (!seen.has(k)) { seen.add(k); columns.push(k); }
    }
  }
  const lines = [columns.map(csvCell).join(',')];
  for (const obj of parsed) {
    lines.push(columns.map((c) => csvCell(obj[c])).join(','));
  }
  return lines.join('\n');
}

function zipResponse(entries: ZipEntries, filename: string): Response {
  // level 0 = store only; the payload is already-compressed HTML/JSON, and store
  // keeps CPU/time low inside the Worker.
  const zipped = zipSync(entries, { level: 0 });
  return new Response(zipped, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** GET /v1/artifacts/:id/export — owner or workspace admin. */
export async function handleExportArtifact(env: Env, user: AuthUser, artifactId: string): Promise<Response> {
  const artifact = await env.DB.prepare(
    'SELECT id, name, slug, owner_id, workspace_id FROM artifacts WHERE id = ? AND deleted_at IS NULL',
  ).bind(artifactId).first<ArtifactRow>();
  if (!artifact) return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

  const isOwner = artifact.owner_id === user.id;
  const wsRole = artifact.workspace_id ? await getInternalWorkspaceRole(env, artifact.workspace_id, user.id) : null;
  const isAdmin = wsRole === 'owner' || wsRole === 'admin';
  if (!isOwner && !isAdmin) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);

  const entries = await collectArtifact(env, artifact);
  return zipResponse(entries, `${safeName(artifact.slug)}.zip`);
}

/** GET /v1/workspaces/:id/export — workspace owner or admin. */
export async function handleExportWorkspace(env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  const wsRole = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (wsRole !== 'owner' && wsRole !== 'admin') return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);

  const list = await env.DB.prepare(
    'SELECT id, name, slug, owner_id, workspace_id FROM artifacts WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY created_at',
  ).bind(workspaceId).all<ArtifactRow>();
  const artifacts = list.results || [];

  if (artifacts.length > MAX_WORKSPACE_ARTIFACTS) {
    return json({
      error: `Workspace has ${artifacts.length} artifacts; export is limited to ${MAX_WORKSPACE_ARTIFACTS}. Export artifacts individually or contact support.`,
      code: 'TOO_MANY_ARTIFACTS',
    }, 413);
  }

  const entries: ZipEntries = {};
  const usedFolders = new Set<string>();
  for (const artifact of artifacts) {
    // Unique per-artifact folder even when two share a slug.
    let folder = safeName(artifact.slug);
    while (usedFolders.has(folder)) folder = `${folder}_${artifact.id.slice(-6)}`;
    usedFolders.add(folder);
    Object.assign(entries, await collectArtifact(env, artifact, `${folder}/`));
  }

  return zipResponse(entries, `workspace-${safeName(workspaceId)}.zip`);
}
