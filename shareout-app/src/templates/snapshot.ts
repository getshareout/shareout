/**
 * Snapshot a source (one artifact, or a folder and everything under it) into a template:
 * the live version's files, type metadata, folder tree, comments/viewer config, and data
 * bindings as placeholders. What is read and what is left behind is listed in
 * `excluded`, so the author sees both before saving.
 *
 * Never copied: store values, table rows (unless the author asks for a few sample rows),
 * dataset contents, connector config or credentials, comments, Knowledge, analytics.
 */
import type { Env, TypeMetadata } from '../types';
import type { AuthUser } from '../api-auth';
import { getUserRole } from '../artifacts/roles';
import { isTextMime } from '../artifacts/files';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { createMiniDb } from '../data/minidb-client';
import { getPlatformOrigin } from '../config/origins';
import { sha256 } from '../crypto-utils';
import { dropLinks, tokenizeLinks, type LinkItem } from './links';
import { mergeFindings, redactSecrets, scanRows, scanText, type ScanContext } from './scan';
import {
  LIMITS, TEMPLATE_ARTIFACT_TYPES,
  type Finding, type SetupStep, type TemplateConnector, type TemplateDataset, type TemplateFolder,
  type TemplateItem, type TemplateManifest, type TemplateSourceKind, type TemplateTable,
} from './types';
import { TemplateError } from './errors';

export interface SnapshotOptions {
  kind: TemplateSourceKind;
  id: string;
  includeSampleRows?: boolean;
  readme?: string | null;
}

export interface Excluded {
  comments: number;
  store_keys: number;
  table_rows: number;
  dataset_rows: number;
  views: number;
  skipped: Array<{ name: string; reason: 'not_published' | 'cannot_edit' | 'unsupported_type' | 'too_many' }>;
}

export interface Snapshot {
  manifest: TemplateManifest;
  /** `<item key>/<path>` → bytes (binary) or text (already tokenized and redacted). */
  blobs: Map<string, Uint8Array | string>;
  findings: Finding[];
  redactions: number;
  removedLinks: number;
  excluded: Excluded;
  workspaceId: string | null;
  sourceName: string;
  totalBytes: number;
}

interface SourceArtifact {
  id: string;
  name: string;
  slug: string;
  display_slug: string | null;
  description: string | null;
  workspace_id: string | null;
  owner_id: string | null;
  folder_id: string | null;
  artifact_type: string;
  type_metadata: string | null;
}

interface SourceFolder { id: string; name: string; parent_id: string | null; readme: string | null; workspace_id: string | null; owner_id: string | null }

const SYSTEM_ROW_KEYS = new Set(['id', 'createdAt', 'updatedAt']);
const CONFIG_KEYS = { comments: '_comments_config', viewer: '_viewer_config' } as const;
const TEXTUAL = /^(text\/|application\/(json|javascript|xml|.*\+xml|.*\+json)$|image\/svg)/;

const ART_COLS = 'id, name, slug, display_slug, description, workspace_id, owner_id, folder_id, artifact_type, type_metadata';

function isText(mime: string): boolean {
  return TEXTUAL.test(mime || '') || isTextMime(mime || '');
}

function hostsFor(env: Env): string[] {
  const out = new Set<string>();
  for (const o of [getPlatformOrigin(env), env.SHAREOUT_BASE_URL, env.ARTIFACT_ORIGIN]) {
    if (!o) continue;
    try { out.add(new URL(o).hostname.toLowerCase()); } catch { /* not a URL */ }
  }
  return [...out];
}

async function canEdit(env: Env, artifactId: string, userId: string): Promise<boolean> {
  const role = await getUserRole(env, artifactId, userId);
  return role === 'owner' || role === 'editor';
}

function cleanRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SYSTEM_ROW_KEYS.has(k) || k.startsWith('_')) continue;
    out[k] = typeof v === 'string' ? redactSecrets(v).text : v;
  }
  return out;
}

function columnsOf(rows: Record<string, unknown>[]): string[] {
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return cols;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function scanContextFor(env: Env, workspaceId: string | null, user: AuthUser): Promise<ScanContext> {
  if (!workspaceId) {
    const me = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(user.id).first<{ name: string | null; email: string | null }>();
    return { workspaceNames: [], memberNames: me?.name ? [me.name] : [], memberEmails: me?.email ? [me.email] : [] };
  }
  const [ws, members] = await Promise.all([
    env.DB.prepare('SELECT name, slug FROM workspaces WHERE id = ?').bind(workspaceId).first<{ name: string; slug: string }>(),
    env.DB.prepare('SELECT u.name, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? LIMIT 500')
      .bind(workspaceId).all<{ name: string | null; email: string | null }>(),
  ]);
  const rows = members.results || [];
  return {
    workspaceNames: ws ? [ws.name, ws.slug].filter((s) => s && s.length >= 3) : [],
    memberNames: rows.map((r) => r.name || '').filter(Boolean),
    memberEmails: rows.map((r) => r.email || '').filter(Boolean),
  };
}

/** The folder, every folder under it (breadth-first) and the artifacts they hold. */
async function loadFolderTree(env: Env, user: AuthUser, folderId: string): Promise<{ root: SourceFolder; folders: SourceFolder[]; artifacts: SourceArtifact[] }> {
  const root = await env.DB.prepare('SELECT id, name, parent_id, readme, workspace_id, owner_id FROM folders WHERE id = ?')
    .bind(folderId).first<SourceFolder>();
  if (!root) throw new TemplateError('NOT_FOUND', 404, 'Folder not found');
  if (root.workspace_id) {
    if (!(await getInternalWorkspaceRole(env, root.workspace_id, user.id))) throw new TemplateError('FORBIDDEN', 403, 'Forbidden');
  } else if (root.owner_id !== user.id) {
    throw new TemplateError('FORBIDDEN', 403, 'Forbidden');
  }
  const folders: SourceFolder[] = [root];
  let frontier = [root.id];
  for (let depth = 0; depth < 10 && frontier.length && folders.length < 100; depth++) {
    const marks = frontier.map(() => '?').join(',');
    const next = (await env.DB.prepare(`SELECT id, name, parent_id, readme, workspace_id, owner_id FROM folders WHERE parent_id IN (${marks}) ORDER BY name`)
      .bind(...frontier).all<SourceFolder>()).results || [];
    folders.push(...next);
    frontier = next.map((f) => f.id);
  }
  const ids = folders.map((f) => f.id);
  const marks = ids.map(() => '?').join(',');
  const artifacts = (await env.DB.prepare(`SELECT ${ART_COLS} FROM artifacts WHERE folder_id IN (${marks}) AND deleted_at IS NULL ORDER BY name LIMIT ${LIMITS.items + 50}`)
    .bind(...ids).all<SourceArtifact>()).results || [];
  return { root, folders, artifacts };
}

async function readConfigAndStore(env: Env, artifactId: string): Promise<{ config: TemplateItem['config']; storeKeys: number }> {
  const db = createMiniDb(env, artifactId, '');
  try {
    const rows = (await db.prepare('SELECT key, value FROM artifact_json WHERE artifact_id = ?').bind(artifactId).all<{ key: string; value: string }>()).results || [];
    const config: TemplateItem['config'] = {};
    let storeKeys = 0;
    for (const r of rows) {
      if (r.key === CONFIG_KEYS.comments || r.key === CONFIG_KEYS.viewer) {
        try { config[r.key === CONFIG_KEYS.comments ? 'comments' : 'viewer'] = JSON.parse(r.value); } catch { /* skip */ }
      } else {
        storeKeys++;
      }
    }
    return { config, storeKeys };
  } catch {
    return { config: {}, storeKeys: 0 };
  }
}

async function readTables(env: Env, artifactId: string, samples: boolean): Promise<{ tables: TemplateTable[]; rows: number }> {
  const db = createMiniDb(env, artifactId, '');
  try {
    const tables = (await db.prepare('SELECT id, name, row_count FROM artifact_tables WHERE artifact_id = ? ORDER BY name').bind(artifactId)
      .all<{ id: string; name: string; row_count: number }>()).results || [];
    const out: TemplateTable[] = [];
    let rows = 0;
    for (const t of tables) {
      rows += t.row_count || 0;
      const data = (await db.prepare(`SELECT data FROM artifact_rows WHERE table_id = ? ORDER BY created_at LIMIT ${LIMITS.schemaScanRows}`).bind(t.id)
        .all<{ data: string }>()).results || [];
      const parsed = data.map((d) => { try { return cleanRow(JSON.parse(d.data) as Record<string, unknown>); } catch { return {}; } });
      out.push({ name: t.name, columns: columnsOf(parsed), ...(samples ? { sample_rows: parsed.slice(0, LIMITS.sampleRows) } : {}) });
    }
    return { tables: out, rows };
  } catch {
    return { tables: [], rows: 0 };
  }
}

async function readDatasets(env: Env, artifactId: string, samples: boolean): Promise<{ datasets: TemplateDataset[]; rows: number }> {
  const list = (await env.DB.prepare('SELECT name, format, r2_key, metadata FROM datasets WHERE artifact_id = ? ORDER BY name').bind(artifactId)
    .all<{ name: string; format: string; r2_key: string; metadata: string | null }>()).results || [];
  const out: TemplateDataset[] = [];
  let rows = 0;
  for (const d of list) {
    let meta: { rowCount?: number; columns?: unknown } = {};
    try { meta = d.metadata ? JSON.parse(d.metadata) : {}; } catch { /* keep {} */ }
    rows += Number(meta.rowCount) || 0;
    let columns = Array.isArray(meta.columns) ? meta.columns.map((c) => (typeof c === 'string' ? c : String((c as { name?: string })?.name ?? ''))).filter(Boolean) : [];
    let sample: Record<string, unknown>[] = [];
    if (!columns.length || samples) {
      const obj = await env.ARTIFACTS.get(d.r2_key, { range: { offset: 0, length: 65536 } }).catch(() => null);
      const head = obj ? await obj.text() : '';
      if (d.format === 'csv' && head) {
        const lines = head.split(/\r?\n/).filter(Boolean);
        const cols = parseCsvLine(lines[0] ?? '');
        if (!columns.length) columns = cols;
        sample = lines.slice(1, 1 + LIMITS.sampleRows).map((l) => Object.fromEntries(parseCsvLine(l).map((v, i) => [cols[i] ?? `col${i + 1}`, v])));
      } else if (head) {
        try {
          const arr = JSON.parse(head) as unknown;
          if (Array.isArray(arr)) {
            const objs = arr.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
            if (!columns.length) columns = columnsOf(objs.slice(0, LIMITS.schemaScanRows));
            sample = objs.slice(0, LIMITS.sampleRows);
          }
        } catch { /* truncated JSON: schema from metadata only */ }
      }
    }
    out.push({ name: d.name, format: d.format, columns, ...(samples ? { sample_rows: sample.map(cleanRow) } : {}) });
  }
  return { datasets: out, rows };
}

async function readConnectors(env: Env, artifactId: string): Promise<TemplateConnector[]> {
  const [own, used] = await Promise.all([
    env.DB.prepare("SELECT name, provider, kind FROM connections WHERE scope_type = 'artifact' AND scope_id = ? ORDER BY name").bind(artifactId)
      .all<{ name: string; provider: string; kind: string }>(),
    env.DB.prepare(`SELECT c.name, c.provider, c.kind FROM connection_usage u JOIN connections c ON c.id = u.connection_id
      WHERE u.artifact_id = ? AND c.scope_type = 'workspace' ORDER BY c.name`).bind(artifactId)
      .all<{ name: string; provider: string; kind: string }>(),
  ]);
  return [
    ...(own.results || []).map((c) => ({ ...c, scope: 'artifact' as const })),
    ...(used.results || []).map((c) => ({ ...c, scope: 'workspace' as const })),
  ];
}

async function counts(env: Env, artifactId: string): Promise<{ comments: number; views: number }> {
  const [c, v] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM artifact_comments WHERE artifact_id = ?').bind(artifactId).first<{ n: number }>(),
    env.DB.prepare('SELECT views FROM artifact_view_totals WHERE artifact_id = ?').bind(artifactId).first<{ views: number }>(),
  ]);
  return { comments: c?.n ?? 0, views: v?.views ?? 0 };
}

export function buildSetup(items: TemplateItem[]): SetupStep[] {
  const steps: SetupStep[] = [];
  const conn = new Map<string, Extract<SetupStep, { kind: 'connector' }>>();
  for (const it of items) {
    for (const c of it.connectors) {
      const k = `${c.provider}:${c.name}`;
      const s = conn.get(k);
      if (s) { if (!s.items.includes(it.key)) s.items.push(it.key); } else {
        const step = { kind: 'connector' as const, name: c.name, provider: c.provider, items: [it.key] };
        conn.set(k, step);
        steps.push(step);
      }
    }
  }
  for (const it of items) {
    for (const t of it.tables) steps.push({ kind: 'table', name: t.name, columns: t.columns, item: it.key });
    for (const d of it.datasets) steps.push({ kind: 'dataset', name: d.name, columns: d.columns, item: it.key });
  }
  return steps;
}

function sanitizeMetadata(raw: string | null): TypeMetadata {
  let meta: TypeMetadata = {};
  try { meta = raw ? JSON.parse(raw) as TypeMetadata : {}; } catch { meta = {}; }
  delete meta.enrichment;
  return meta;
}

export async function snapshotSource(env: Env, user: AuthUser, opts: SnapshotOptions): Promise<Snapshot> {
  let artifacts: SourceArtifact[];
  let folders: SourceFolder[] = [];
  let workspaceId: string | null;
  let sourceName: string;
  let rootFolderId: string | null = null;
  let readme: string | null = opts.readme ?? null;

  if (opts.kind === 'artifact') {
    const a = await env.DB.prepare(`SELECT ${ART_COLS} FROM artifacts WHERE id = ? AND deleted_at IS NULL`).bind(opts.id).first<SourceArtifact>();
    if (!a) throw new TemplateError('NOT_FOUND', 404, 'Artifact not found');
    if (!(await canEdit(env, a.id, user.id))) throw new TemplateError('FORBIDDEN', 403, 'Only people who can edit this page can save it as a template');
    artifacts = [a];
    workspaceId = a.workspace_id;
    sourceName = a.name;
  } else {
    const tree = await loadFolderTree(env, user, opts.id);
    artifacts = tree.artifacts;
    folders = tree.folders;
    workspaceId = tree.root.workspace_id;
    sourceName = tree.root.name;
    rootFolderId = tree.root.id;
    if (readme === null) readme = tree.root.readme;
  }

  const excluded: Excluded = { comments: 0, store_keys: 0, table_rows: 0, dataset_rows: 0, views: 0, skipped: [] };
  const included: Array<{ a: SourceArtifact; versionId: string; entrypoint: string; mobile: string | null }> = [];
  for (const a of artifacts) {
    const meta = sanitizeMetadata(a.type_metadata);
    if (!TEMPLATE_ARTIFACT_TYPES.includes(a.artifact_type as never) || meta.skill || meta.library) { excluded.skipped.push({ name: a.name, reason: 'unsupported_type' }); continue; }
    if (opts.kind === 'folder' && !(await canEdit(env, a.id, user.id))) { excluded.skipped.push({ name: a.name, reason: 'cannot_edit' }); continue; }
    const live = await env.DB.prepare(`SELECT v.id, v.entrypoint, v.mobile_entrypoint FROM deployments d JOIN versions v ON v.id = d.version_id
      WHERE d.artifact_id = ? AND d.channel = 'production'`).bind(a.id).first<{ id: string; entrypoint: string; mobile_entrypoint: string | null }>();
    if (!live) { excluded.skipped.push({ name: a.name, reason: 'not_published' }); continue; }
    if (included.length >= LIMITS.items) { excluded.skipped.push({ name: a.name, reason: 'too_many' }); continue; }
    included.push({ a, versionId: live.id, entrypoint: live.entrypoint, mobile: live.mobile_entrypoint });
  }
  if (!included.length) throw new TemplateError('NOTHING_TO_SAVE', 422, 'Nothing here can go in a template: it needs at least one published page you can edit', { skipped: excluded.skipped });

  const folderKey = new Map<string, string>(folders.map((f, i) => [f.id, `f${i + 1}`]));
  const tplFolders: TemplateFolder[] = folders.map((f) => ({
    key: folderKey.get(f.id)!,
    name: f.name,
    parent: f.id === rootFolderId ? null : (f.parent_id ? folderKey.get(f.parent_id) ?? null : null),
    readme: f.id === rootFolderId ? null : f.readme,
  }));

  const linkItems: LinkItem[] = included.map(({ a }, i) => ({ key: `a${i + 1}`, id: a.id, slug: a.slug, displaySlug: a.display_slug || a.slug }));
  const wsSlug = workspaceId ? (await env.DB.prepare('SELECT slug FROM workspaces WHERE id = ?').bind(workspaceId).first<{ slug: string }>())?.slug ?? null : null;
  const hosts = hostsFor(env);
  const scanCtx = await scanContextFor(env, workspaceId, user);

  const blobs = new Map<string, Uint8Array | string>();
  const textKeys: string[] = [];
  const unknownSlugs = new Set<string>();
  const items: TemplateItem[] = [];
  let totalBytes = 0;
  let removedLinks = 0;

  for (let i = 0; i < included.length; i++) {
    const { a, versionId, entrypoint, mobile } = included[i];
    const key = linkItems[i].key;
    const assets = (await env.DB.prepare('SELECT path, r2_key, mime, size_bytes FROM assets WHERE version_id = ? ORDER BY path').bind(versionId)
      .all<{ path: string; r2_key: string; mime: string; size_bytes: number }>()).results || [];
    if (assets.length > LIMITS.filesPerItem) throw new TemplateError('TOO_LARGE', 413, `"${a.name}" has more than ${LIMITS.filesPerItem} files`);
    const files: TemplateItem['files'] = [];
    let needsIds = false;
    for (const asset of assets) {
      const obj = await env.ARTIFACTS.get(asset.r2_key);
      if (!obj) continue;
      const bkey = `${key}/${asset.path}`;
      if (isText(asset.mime)) {
        const tk = tokenizeLinks(await obj.text(), { items: linkItems, workspaceId, workspaceSlug: wsSlug, hosts });
        tk.unknownSlugs.forEach((s) => unknownSlugs.add(s));
        removedLinks += tk.removedLinks;
        needsIds ||= tk.needsIds;
        blobs.set(bkey, tk.text);
        textKeys.push(bkey);
        files.push({ path: asset.path, mime: asset.mime, size: 0, sha256: '', text: true });
      } else {
        const bytes = new Uint8Array(await obj.arrayBuffer());
        blobs.set(bkey, bytes);
        files.push({ path: asset.path, mime: asset.mime, size: bytes.byteLength, sha256: await sha256(bytes.buffer as ArrayBuffer), text: false });
      }
    }
    const meta = sanitizeMetadata(a.type_metadata);
    const [cfg, tables, datasets, connectors, n] = await Promise.all([
      readConfigAndStore(env, a.id),
      readTables(env, a.id, !!opts.includeSampleRows),
      readDatasets(env, a.id, !!opts.includeSampleRows),
      readConnectors(env, a.id),
      counts(env, a.id),
    ]);
    excluded.store_keys += cfg.storeKeys;
    excluded.table_rows += tables.rows;
    excluded.dataset_rows += datasets.rows;
    excluded.comments += n.comments;
    excluded.views += n.views;
    items.push({
      key,
      name: a.name,
      slug: a.display_slug || a.slug,
      description: a.description ? redactSecrets(a.description).text : null,
      artifact_type: a.artifact_type as TemplateItem['artifact_type'],
      entrypoint,
      mobile_entrypoint: mobile,
      folder: a.folder_id ? folderKey.get(a.folder_id) ?? null : null,
      files,
      ...(meta.source ? { source: meta.source } : {}),
      config: cfg.config,
      tables: tables.tables,
      datasets: datasets.datasets,
      connectors,
      ...(needsIds ? { needs_ids: true } : {}),
    });
  }

  // Links to pages of the source workspace that are not in the template become '#'.
  let local: string[] = [];
  if (unknownSlugs.size) {
    const list = [...unknownSlugs].slice(0, 200);
    const marks = list.map(() => '?').join(',');
    const rows = workspaceId
      ? await env.DB.prepare(`SELECT slug FROM artifacts WHERE slug IN (${marks}) AND workspace_id = ?`).bind(...list, workspaceId).all<{ slug: string }>()
      : await env.DB.prepare(`SELECT slug FROM artifacts WHERE slug IN (${marks}) AND workspace_id IS NULL AND owner_id = ?`).bind(...list, user.id).all<{ slug: string }>();
    local = (rows.results || []).map((r) => r.slug);
  }

  const findings: Finding[] = [];
  let redactions = 0;
  for (const bkey of textKeys) {
    const dropped = dropLinks(blobs.get(bkey) as string, local, hosts);
    removedLinks += dropped.removed;
    const red = redactSecrets(dropped.text);
    redactions += red.count;
    blobs.set(bkey, red.text);
    const [itemKey, ...rest] = bkey.split('/');
    findings.push(...scanText(red.text, scanCtx, itemKey, rest.join('/')));
  }

  for (const it of items) {
    for (const f of it.files) {
      if (!f.text) { totalBytes += f.size; continue; }
      const bytes = new TextEncoder().encode(blobs.get(`${it.key}/${f.path}`) as string);
      f.size = bytes.byteLength;
      f.sha256 = await sha256(bytes.buffer as ArrayBuffer);
      totalBytes += f.size;
    }
    findings.push(...scanText(`${it.name}\n${it.description ?? ''}`, scanCtx, it.key, 'name'));
    for (const t of it.tables) if (t.sample_rows) findings.push(...scanRows(t.sample_rows, scanCtx, it.key, `table:${t.name}`));
    for (const d of it.datasets) if (d.sample_rows) findings.push(...scanRows(d.sample_rows, scanCtx, it.key, `dataset:${d.name}`));
  }
  for (const f of tplFolders) findings.push(...scanText(`${f.name}\n${f.readme ?? ''}`, scanCtx, null, `folder:${f.key}`));
  if (readme) {
    const red = redactSecrets(readme.slice(0, LIMITS.readme));
    redactions += red.count;
    readme = red.text;
    findings.push(...scanText(readme, scanCtx, null, 'readme'));
  }
  if (totalBytes > LIMITS.totalBytes) throw new TemplateError('TOO_LARGE', 413, `A template can hold up to ${LIMITS.totalBytes / 1024 / 1024} MB`);

  const manifest: TemplateManifest = {
    format: 1,
    readme,
    root_folder: rootFolderId ? folderKey.get(rootFolderId)! : null,
    folders: tplFolders,
    items,
    setup: buildSetup(items),
  };
  return { manifest, blobs, findings: mergeFindings(findings), redactions, removedLinks, excluded, workspaceId, sourceName, totalBytes };
}

/** What the author is shown before saving: everything included, everything left behind. */
export function previewOf(s: Snapshot) {
  return {
    source_name: s.sourceName,
    items: s.manifest.items.map((it) => ({
      key: it.key,
      name: it.name,
      artifact_type: it.artifact_type,
      folder: it.folder,
      files: it.files.map((f) => ({ path: f.path, size: f.size })),
      tables: it.tables.map((t) => ({ name: t.name, columns: t.columns, sample_rows: t.sample_rows?.length ?? 0 })),
      datasets: it.datasets.map((d) => ({ name: d.name, format: d.format, columns: d.columns, sample_rows: d.sample_rows?.length ?? 0 })),
      connectors: it.connectors.map((c) => ({ name: c.name, provider: c.provider })),
      comments_config: it.config.comments !== undefined,
    })),
    folders: s.manifest.folders.map((f) => ({ key: f.key, name: f.name, parent: f.parent })),
    setup: s.manifest.setup,
    excluded: { ...s.excluded, knowledge: true, credentials: true },
    findings: s.findings,
    redactions: s.redactions,
    removed_links: s.removedLinks,
    size_bytes: s.totalBytes,
  };
}
