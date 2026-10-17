/**
 * Install a template into a workspace (or a personal space), and move installed copies
 * to a newer template version.
 *
 * Install creates the folder tree and the artifacts through the normal publish pipeline
 * (quotas, moderation and workspace publish policy all apply), rewrites links between
 * template items to the new slugs, creates empty tables and datasets from the schema
 * (with the sample rows the author chose to include, if any), restores comments/viewer
 * config, and records template id + version on every artifact it made.
 *
 * Update is non-destructive, like a restore: each installed artifact gets a NEW version
 * with the template's files, so the history keeps every earlier one. Data is never
 * touched; tables and datasets the new version adds are created empty.
 */
import type { Env, FileEntry } from '../types';
import type { AuthUser } from '../api-auth';
import { checkRateLimit, incrementRateLimit } from '../api-auth';
import { generateId, sha256 } from '../crypto-utils';
import { generateSlug } from '../validation';
import { publishArtifact } from '../publish/publish-artifact';
import { storeVersionAssets } from '../publish/assets';
import { buildEnhancedManifest } from '../publish/manifest';
import { promoteVersion } from '../publish/deployment';
import { createMiniDb } from '../data/minidb-client';
import { writeDatasetRows } from '../data/datasets/handler';
import { getUserRole } from '../artifacts/roles';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { membersCanCreateFolders } from '../folders';
import { checkStorageQuota } from '../quota';
import { getPlatformOrigin } from '../config/origins';
import { invalidateDeploymentCache } from '../serve/deployment-cache';
import { resolveTokens, type ResolvedItem } from './links';
import { getTemplate, loadItemFiles, loadVersion, scopeAllows } from './store';
import { TemplateError } from './errors';
import type { SetupStep, TemplateItem, TemplateManifest, TemplateRow } from './types';

export interface InstallTarget {
  /** null = the caller's personal space. */
  workspaceId: string | null;
  folderId?: string | null;
}

export interface InstallOptions {
  /**
   * Server-side caller (workspace provisioning) that already decided the actor may
   * install here: skips the membership and rate checks. The template's scope is still
   * checked against the target workspace, so a private template of another workspace
   * can never be installed this way.
   */
  trusted?: boolean;
}

export interface InstalledArtifact { key: string; artifact_id: string; name: string; slug: string; url: string }

export interface SetupStatus { step: SetupStep; done: boolean }

export interface InstallResult {
  template_id: string;
  version_no: number;
  install_group: string;
  folder_id: string | null;
  artifacts: InstalledArtifact[];
  setup: SetupStatus[];
}

async function freeArtifactSlug(env: Env, base: string, workspaceId: string | null, userId: string, taken: Set<string>): Promise<string> {
  const root = (generateSlug(base) || 'page').slice(0, 44);
  for (let n = 1; n < 200; n++) {
    const s = n === 1 ? root : `${root}-${n}`;
    if (taken.has(s)) continue;
    // Free as a routing slug everywhere AND as a human slug in this scope: then publish
    // creates a new artifact (never updates someone's page) and its /a/<slug> is `s`.
    const hit = workspaceId
      ? await env.DB.prepare('SELECT 1 FROM artifacts WHERE slug = ? OR (display_slug = ? AND workspace_id = ?) LIMIT 1').bind(s, s, workspaceId).first()
      : await env.DB.prepare('SELECT 1 FROM artifacts WHERE slug = ? OR (display_slug = ? AND workspace_id IS NULL AND owner_id = ?) LIMIT 1').bind(s, s, userId).first();
    if (!hit) { taken.add(s); return s; }
  }
  const s = `${root}-${crypto.randomUUID().slice(0, 6)}`;
  taken.add(s);
  return s;
}

async function createFolder(env: Env, user: AuthUser, workspaceId: string | null, parentId: string | null, name: string, readme: string | null): Promise<string> {
  const base = generateSlug(name) || 'folder';
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const clash = workspaceId
      ? await env.DB.prepare("SELECT 1 FROM folders WHERE workspace_id = ? AND IFNULL(parent_id, '~') = IFNULL(?, '~') AND slug = ?").bind(workspaceId, parentId, slug).first()
      : await env.DB.prepare("SELECT 1 FROM folders WHERE workspace_id IS NULL AND owner_id = ? AND IFNULL(parent_id, '~') = IFNULL(?, '~') AND slug = ?").bind(user.id, parentId, slug).first();
    if (clash) continue;
    const id = generateId('fld');
    await env.DB.prepare(`INSERT INTO folders (id, workspace_id, owner_id, name, slug, parent_id, readme, visibility, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'inherit', ?)`).bind(id, workspaceId, workspaceId ? null : user.id, name.slice(0, 120), slug, parentId, readme, user.id).run();
    return id;
  }
  throw new TemplateError('CONFLICT', 409, 'Could not find a free folder name');
}

async function checkTarget(env: Env, user: AuthUser, target: InstallTarget, trusted: boolean): Promise<{ canCreateFolders: boolean }> {
  let canCreateFolders = true;
  if (target.workspaceId) {
    const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE id = ?').bind(target.workspaceId).first();
    if (!ws) throw new TemplateError('NOT_FOUND', 404, 'Workspace not found');
    if (!trusted) {
      const role = await getInternalWorkspaceRole(env, target.workspaceId, user.id);
      if (!role) throw new TemplateError('FORBIDDEN', 403, 'Forbidden');
      canCreateFolders = role === 'owner' || role === 'admin' || (await membersCanCreateFolders(env, target.workspaceId));
    }
  }
  if (target.folderId) {
    const f = target.workspaceId
      ? await env.DB.prepare('SELECT id FROM folders WHERE id = ? AND workspace_id = ?').bind(target.folderId, target.workspaceId).first()
      : await env.DB.prepare('SELECT id FROM folders WHERE id = ? AND workspace_id IS NULL AND owner_id = ?').bind(target.folderId, user.id).first();
    if (!f) throw new TemplateError('FOLDER_NOT_FOUND', 404, 'Folder not found in that space');
  }
  return { canCreateFolders };
}

function resolveFiles(files: FileEntry[], map: Record<string, ResolvedItem>, origin: string, workspaceId: string | null): FileEntry[] {
  return files.map((f) => (f.encoding === 'base64' ? f : { ...f, content: resolveTokens(f.content, map, origin, workspaceId) }));
}

/** Split the mobile entry out of the file list: publish stores it from `mobileHtml`. */
function splitMobile(item: TemplateItem, files: FileEntry[]): { files: FileEntry[]; mobileHtml?: string; mobileEntrypoint?: string } {
  const m = item.mobile_entrypoint ? files.find((f) => f.path === item.mobile_entrypoint && f.encoding !== 'base64') : undefined;
  if (!m) return { files };
  return { files: files.filter((f) => f !== m), mobileHtml: m.content, mobileEntrypoint: m.path };
}

async function writeData(env: Env, artifactId: string, workspaceId: string | null, item: TemplateItem, onlyMissing: boolean): Promise<void> {
  const db = createMiniDb(env, artifactId, workspaceId ?? '');
  const now = new Date().toISOString();
  if (!onlyMissing) {
    for (const [cfg, key] of [[item.config.comments, '_comments_config'], [item.config.viewer, '_viewer_config']] as const) {
      if (cfg === undefined) continue;
      const value = JSON.stringify(cfg);
      await db.prepare(`INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(artifact_id, key) DO UPDATE SET value = excluded.value, size_bytes = excluded.size_bytes, updated_at = excluded.updated_at`)
        .bind(generateId('json'), artifactId, key, value, new TextEncoder().encode(value).length, now, now).run();
      if (env.SLUGS) { try { await env.SLUGS.delete(`${key === '_comments_config' ? 'cmtcfg' : 'vwcfg'}:${artifactId}`); } catch { /* cache only */ } }
    }
  }
  for (const t of item.tables) {
    const exists = await db.prepare('SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?').bind(artifactId, t.name).first<{ id: string }>();
    if (exists) continue;
    const tableId = generateId('tbl');
    const rows = t.sample_rows ?? [];
    await db.batch([
      { sql: 'INSERT INTO artifact_tables (id, artifact_id, name, row_count) VALUES (?, ?, ?, ?)', bindings: [tableId, artifactId, t.name, rows.length], mode: 'run' },
      ...rows.map((r) => {
        const id = generateId('row');
        return { sql: 'INSERT INTO artifact_rows (id, table_id, data) VALUES (?, ?, ?)', bindings: [id, tableId, JSON.stringify({ id, ...r, createdAt: now, updatedAt: now })], mode: 'run' as const };
      }),
    ]);
  }
  for (const d of item.datasets) {
    const exists = await env.DB.prepare('SELECT 1 FROM datasets WHERE artifact_id = ? AND name = ?').bind(artifactId, d.name).first();
    if (exists) continue;
    const format = d.format === 'json' ? 'json' : 'csv';
    if (d.sample_rows?.length) {
      await writeDatasetRows(env, artifactId, d.name, format, d.sample_rows);
      continue;
    }
    const body = format === 'json' ? '[]' : `${d.columns.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')}\n`;
    const bytes = new TextEncoder().encode(body);
    const r2Key = `${artifactId}/datasets/${d.name}/${generateId('mat')}.${format}`;
    await env.ARTIFACTS.put(r2Key, bytes, { httpMetadata: { contentType: format === 'json' ? 'application/json' : 'text/csv' } });
    await env.DB.prepare(`INSERT INTO datasets (id, artifact_id, name, format, r2_key, size_bytes, sha256, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(generateId('dst'), artifactId, d.name, format, r2Key, bytes.byteLength, await sha256(bytes.buffer as ArrayBuffer), JSON.stringify({ rowCount: 0, columns: d.columns }), now, now).run();
  }
}

/** A new head version on an existing artifact (source 'template'), promoted like a publish. */
async function writeVersion(env: Env, user: AuthUser, artifactId: string, item: TemplateItem, files: FileEntry[], message: string): Promise<number> {
  const art = await env.DB.prepare(`SELECT COALESCE(d.slug, a.slug) AS slug FROM artifacts a
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production' WHERE a.id = ?`).bind(artifactId).first<{ slug: string }>();
  if (!art) throw new TemplateError('NOT_FOUND', 404, 'Artifact not found');
  const head = await env.DB.prepare('SELECT MAX(version_no) AS n FROM versions WHERE artifact_id = ?').bind(artifactId).first<{ n: number | null }>();
  const versionNo = (head?.n ?? 0) + 1;
  const versionId = generateId('ver');
  const { files: main, mobileHtml, mobileEntrypoint } = splitMobile(item, files);
  await env.DB.prepare(`INSERT INTO versions (id, artifact_id, version_no, entrypoint, mobile_entrypoint, manifest_json, created_at, created_by, source, message, message_source)
    VALUES (?, ?, ?, ?, ?, '{}', ?, ?, 'template', ?, 'author')`)
    .bind(versionId, artifactId, versionNo, item.entrypoint, mobileEntrypoint ?? null, new Date().toISOString(), user.id, message).run();
  const meta = await storeVersionAssets(env, versionId, artifactId, versionNo, main, mobileHtml, mobileEntrypoint ?? null);
  await env.DB.prepare('UPDATE versions SET manifest_json = ? WHERE id = ?').bind(JSON.stringify(buildEnhancedManifest(item.entrypoint, meta, mobileEntrypoint ?? null)), versionId).run();
  await promoteVersion(env, artifactId, versionId, art.slug);
  await invalidateDeploymentCache(env, art.slug, artifactId);
  return versionNo;
}

async function connectorReady(env: Env, workspaceId: string | null, artifactIds: string[], name: string): Promise<boolean> {
  if (workspaceId && await env.DB.prepare("SELECT 1 FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND name = ? AND (encrypted_credentials IS NOT NULL OR credential_scope = 'per_user')")
    .bind(workspaceId, name).first()) return true;
  for (const id of artifactIds) {
    if (await env.DB.prepare("SELECT 1 FROM connections WHERE scope_type = 'artifact' AND scope_id = ? AND name = ? AND encrypted_credentials IS NOT NULL").bind(id, name).first()) return true;
  }
  return false;
}

/** The "finish setup" checklist for one install group, with what is already done. */
export async function setupStatus(env: Env, workspaceId: string | null, manifest: TemplateManifest, byKey: Record<string, string>): Promise<SetupStatus[]> {
  const out: SetupStatus[] = [];
  for (const step of manifest.setup) {
    if (step.kind === 'connector') {
      out.push({ step, done: await connectorReady(env, workspaceId, step.items.map((k) => byKey[k]).filter(Boolean), step.name) });
    } else if (step.kind === 'table') {
      const id = byKey[step.item];
      const row = id ? await createMiniDb(env, id, workspaceId ?? '').prepare('SELECT row_count FROM artifact_tables WHERE artifact_id = ? AND name = ?').bind(id, step.name).first<{ row_count: number }>().catch(() => null) : null;
      out.push({ step, done: !!row && row.row_count > 0 });
    } else {
      const id = byKey[step.item];
      const row = id ? await env.DB.prepare('SELECT metadata FROM datasets WHERE artifact_id = ? AND name = ?').bind(id, step.name).first<{ metadata: string | null }>() : null;
      let n = 0;
      try { n = Number(JSON.parse(row?.metadata ?? '{}').rowCount) || 0; } catch { n = 0; }
      out.push({ step, done: n > 0 });
    }
  }
  return out;
}

export async function installTemplate(env: Env, user: AuthUser, templateId: string, target: InstallTarget, opts: InstallOptions = {}): Promise<InstallResult> {
  const t = await getTemplate(env, templateId);
  if (!t || t.current_version_no < 1) throw new TemplateError('NOT_FOUND', 404, 'Template not found');
  if (!(await scopeAllows(env, t, target.workspaceId, user.id))) {
    // Not visible from here: same answer as a missing template, so ids can't be probed.
    throw new TemplateError('NOT_FOUND', 404, 'Template not found');
  }
  const { canCreateFolders } = await checkTarget(env, user, target, !!opts.trusted);
  const { versionNo, label, manifest } = await loadVersion(env, t);

  const filesByKey = new Map<string, FileEntry[]>();
  for (const item of manifest.items) filesByKey.set(item.key, await loadItemFiles(env, t.id, versionNo, item));

  if (!opts.trusted) {
    const rate = await checkRateLimit(env, user.id, 'publish', user.email);
    if (!rate.allowed) throw new TemplateError('RATE_LIMITED', 429, 'Daily publish limit reached. Try again tomorrow.');
    const quota = await checkStorageQuota(env, user.id, [...filesByKey.values()].flat());
    if (!quota.allowed) throw new TemplateError('STORAGE_LIMIT_EXCEEDED', 413, 'Installing this template would go over the storage limit');
  }

  const folderMap = new Map<string, string>();
  const base = target.folderId ?? null;
  let rootFolder: string | null = base;
  if (manifest.root_folder && canCreateFolders) {
    const pending = [...manifest.folders];
    const root = pending.find((f) => f.key === manifest.root_folder);
    rootFolder = await createFolder(env, user, target.workspaceId, base, root?.name ?? t.name, manifest.readme);
    folderMap.set(manifest.root_folder, rootFolder);
    for (let guard = 0; pending.length && guard < 20; guard++) {
      for (const f of [...pending]) {
        if (folderMap.has(f.key)) { pending.splice(pending.indexOf(f), 1); continue; }
        const parent = f.parent ? folderMap.get(f.parent) : rootFolder;
        if (f.parent && !parent) continue;
        folderMap.set(f.key, await createFolder(env, user, target.workspaceId, parent ?? rootFolder, f.name, f.readme));
        pending.splice(pending.indexOf(f), 1);
      }
    }
  }

  const taken = new Set<string>();
  const map: Record<string, ResolvedItem> = {};
  for (const item of manifest.items) map[item.key] = { slug: await freeArtifactSlug(env, item.slug, target.workspaceId, user.id, taken), id: '' };

  const origin = getPlatformOrigin(env).replace(/\/$/, '');
  const group = generateId('tig');
  const artifacts: InstalledArtifact[] = [];
  const byKey: Record<string, string> = {};
  for (const item of manifest.items) {
    const files = resolveFiles(filesByKey.get(item.key)!, map, origin, target.workspaceId);
    const { files: main, mobileHtml, mobileEntrypoint } = splitMobile(item, files);
    const folderId = (item.folder && folderMap.get(item.folder)) || rootFolder;
    const res = await publishArtifact(env, user, {
      name: item.name,
      slug: map[item.key].slug,
      entrypoint: item.entrypoint,
      files: main,
      mobileHtml,
      mobileEntrypoint,
      visibility: target.workspaceId ? 'workspace' : 'private',
      authMethod: 'google',
      shareWith: [],
      credentials: [],
      workspaceId: target.workspaceId,
      folderId,
      artifactType: item.artifact_type,
      source: item.source,
      message: `Installed from template "${t.name}" v${label}`,
    });
    map[item.key] = { slug: res.deployment.slug, id: res.artifact.id };
    byKey[item.key] = res.artifact.id;
    if (item.description) await env.DB.prepare('UPDATE artifacts SET description = ? WHERE id = ?').bind(item.description, res.artifact.id).run();
    artifacts.push({ key: item.key, artifact_id: res.artifact.id, name: item.name, slug: res.deployment.slug, url: res.deployment.url });
    await env.DB.prepare(`INSERT INTO template_installs (id, template_id, artifact_id, workspace_id, install_group, item_key, version_no, folder_id, installed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(generateId('tin'), t.id, res.artifact.id, target.workspaceId, group, item.key, versionNo, folderId, user.id).run();
    await writeData(env, res.artifact.id, target.workspaceId, item, false);
  }

  // Pages that name another page by its id: now that every id exists, write them once more.
  for (const item of manifest.items.filter((i) => i.needs_ids)) {
    await writeVersion(env, user, byKey[item.key], item, resolveFiles(filesByKey.get(item.key)!, map, origin, target.workspaceId), `Installed from template "${t.name}" v${label}`);
  }

  if (!opts.trusted) await incrementRateLimit(env, user.id, 'publish', user.email);
  return {
    template_id: t.id,
    version_no: versionNo,
    install_group: group,
    folder_id: rootFolder,
    artifacts,
    setup: await setupStatus(env, target.workspaceId, manifest, byKey),
  };
}

export interface InstallRow { id: string; template_id: string; artifact_id: string; workspace_id: string | null; install_group: string; item_key: string; version_no: number; folder_id: string | null }

export async function installOf(env: Env, artifactId: string): Promise<InstallRow | null> {
  return env.DB.prepare('SELECT id, template_id, artifact_id, workspace_id, install_group, item_key, version_no, folder_id FROM template_installs WHERE artifact_id = ?')
    .bind(artifactId).first<InstallRow>();
}

async function groupRows(env: Env, group: string): Promise<InstallRow[]> {
  const rows = await env.DB.prepare(`SELECT i.id, i.template_id, i.artifact_id, i.workspace_id, i.install_group, i.item_key, i.version_no, i.folder_id
    FROM template_installs i JOIN artifacts a ON a.id = i.artifact_id WHERE i.install_group = ? AND a.deleted_at IS NULL`).bind(group).all<InstallRow>();
  return rows.results || [];
}

export interface UpdatePlan {
  template_id: string;
  template_name: string;
  from_version: number;
  to_version: number;
  to_label: string;
  notes: string | null;
  changes: Array<{ key: string; artifact_id: string | null; name: string; change: 'update' | 'unchanged' | 'add'; files_changed: number; files_added: number; files_removed: number }>;
  removed_from_template: Array<{ artifact_id: string; key: string }>;
}

async function liveHashes(env: Env, artifactId: string): Promise<Map<string, string>> {
  const rows = await env.DB.prepare(`SELECT s.path, s.sha256 FROM deployments d JOIN assets s ON s.version_id = d.version_id
    WHERE d.artifact_id = ? AND d.channel = 'production'`).bind(artifactId).all<{ path: string; sha256: string }>();
  return new Map((rows.results || []).map((r) => [r.path, r.sha256]));
}

async function contentHash(f: FileEntry): Promise<string> {
  const bytes = f.encoding === 'base64' ? Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0)) : new TextEncoder().encode(f.content);
  return sha256(bytes.buffer as ArrayBuffer);
}

async function prepareUpdate(env: Env, user: AuthUser, artifactId: string) {
  const mine = await installOf(env, artifactId);
  if (!mine) throw new TemplateError('NOT_INSTALLED', 404, 'This page was not installed from a template');
  const t = await getTemplate(env, mine.template_id) as TemplateRow | null;
  if (!t || !(await scopeAllows(env, t, mine.workspace_id, user.id))) throw new TemplateError('NOT_FOUND', 404, 'Template not found');
  const rows = await groupRows(env, mine.install_group);
  for (const r of rows) {
    const role = await getUserRole(env, r.artifact_id, user.id);
    if (role !== 'owner' && role !== 'editor') throw new TemplateError('FORBIDDEN', 403, 'You need edit access to every page of this install to update it');
  }
  const current = Math.max(...rows.map((r) => r.version_no));
  const target = await loadVersion(env, t);
  return { t, rows, current, target };
}

/** What an update would change, per artifact — shown before the person confirms. */
export async function planUpdate(env: Env, user: AuthUser, artifactId: string): Promise<UpdatePlan> {
  const { t, rows, current, target } = await prepareUpdate(env, user, artifactId);
  const byKey = new Map(rows.map((r) => [r.item_key, r]));
  const map: Record<string, ResolvedItem> = {};
  for (const r of rows) {
    const a = await env.DB.prepare('SELECT slug FROM artifacts WHERE id = ?').bind(r.artifact_id).first<{ slug: string }>();
    map[r.item_key] = { slug: a?.slug ?? '', id: r.artifact_id };
  }
  const origin = getPlatformOrigin(env).replace(/\/$/, '');
  const ws = rows[0]?.workspace_id ?? null;
  const changes: UpdatePlan['changes'] = [];
  for (const item of target.manifest.items) {
    const row = byKey.get(item.key);
    if (!row) { changes.push({ key: item.key, artifact_id: null, name: item.name, change: 'add', files_changed: 0, files_added: item.files.length, files_removed: 0 }); continue; }
    const live = await liveHashes(env, row.artifact_id);
    const files = resolveFiles(await loadItemFiles(env, t.id, target.versionNo, item), map, origin, ws);
    let changed = 0, added = 0;
    for (const f of files) {
      const h = live.get(f.path);
      if (h === undefined) added++;
      else if (h !== await contentHash(f)) changed++;
    }
    const removed = [...live.keys()].filter((p) => !files.some((f) => f.path === p)).length;
    changes.push({ key: item.key, artifact_id: row.artifact_id, name: item.name, change: changed || added || removed ? 'update' : 'unchanged', files_changed: changed, files_added: added, files_removed: removed });
  }
  const keys = new Set(target.manifest.items.map((i) => i.key));
  return {
    template_id: t.id,
    template_name: t.name,
    from_version: current,
    to_version: target.versionNo,
    to_label: target.label,
    notes: target.notes,
    changes,
    removed_from_template: rows.filter((r) => !keys.has(r.item_key)).map((r) => ({ artifact_id: r.artifact_id, key: r.item_key })),
  };
}

/** Apply the template's current version to every artifact of an install (non-destructive). */
export async function applyUpdate(env: Env, user: AuthUser, artifactId: string): Promise<{ updated: string[]; added: InstalledArtifact[]; version_no: number; setup: SetupStatus[] }> {
  const { t, rows, target } = await prepareUpdate(env, user, artifactId);
  const ws = rows[0]?.workspace_id ?? null;
  const group = rows[0].install_group;
  const origin = getPlatformOrigin(env).replace(/\/$/, '');
  const byKey = new Map(rows.map((r) => [r.item_key, r]));
  const map: Record<string, ResolvedItem> = {};
  for (const r of rows) {
    const a = await env.DB.prepare('SELECT slug FROM artifacts WHERE id = ?').bind(r.artifact_id).first<{ slug: string }>();
    map[r.item_key] = { slug: a?.slug ?? '', id: r.artifact_id };
  }
  const taken = new Set<string>();
  for (const item of target.manifest.items) {
    if (!map[item.key]) map[item.key] = { slug: await freeArtifactSlug(env, item.slug, ws, user.id, taken), id: '' };
  }
  const message = `Updated from template "${t.name}" v${target.label}`;
  const updated: string[] = [];
  const added: InstalledArtifact[] = [];
  const now = new Date().toISOString();
  for (const item of target.manifest.items) {
    const raw = await loadItemFiles(env, t.id, target.versionNo, item);
    const row = byKey.get(item.key);
    if (row) {
      await writeVersion(env, user, row.artifact_id, item, resolveFiles(raw, map, origin, ws), message);
      await writeData(env, row.artifact_id, ws, item, true);
      await env.DB.prepare('UPDATE template_installs SET version_no = ?, updated_at = ? WHERE id = ?').bind(target.versionNo, now, row.id).run();
      updated.push(row.artifact_id);
      continue;
    }
    const folderId = rows[0].folder_id;
    const { files: main, mobileHtml, mobileEntrypoint } = splitMobile(item, resolveFiles(raw, map, origin, ws));
    const res = await publishArtifact(env, user, {
      name: item.name, slug: map[item.key].slug, entrypoint: item.entrypoint, files: main, mobileHtml, mobileEntrypoint,
      visibility: ws ? 'workspace' : 'private', authMethod: 'google', shareWith: [], credentials: [],
      workspaceId: ws, folderId, artifactType: item.artifact_type, source: item.source, message,
    });
    map[item.key] = { slug: res.deployment.slug, id: res.artifact.id };
    await env.DB.prepare(`INSERT INTO template_installs (id, template_id, artifact_id, workspace_id, install_group, item_key, version_no, folder_id, installed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(generateId('tin'), t.id, res.artifact.id, ws, group, item.key, target.versionNo, folderId, user.id).run();
    await writeData(env, res.artifact.id, ws, item, false);
    added.push({ key: item.key, artifact_id: res.artifact.id, name: item.name, slug: res.deployment.slug, url: res.deployment.url });
  }
  const ids = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.id]));
  return { updated, added, version_no: target.versionNo, setup: await setupStatus(env, ws, target.manifest, ids) };
}

/** Install info for one artifact (the inspector's "from template" note and update banner). */
export async function installInfo(env: Env, artifactId: string) {
  const row = await installOf(env, artifactId);
  if (!row) return null;
  const t = await getTemplate(env, row.template_id);
  if (!t) return null;
  const rows = await groupRows(env, row.install_group);
  const ids = Object.fromEntries(rows.map((r) => [r.item_key, r.artifact_id]));
  const installed = await loadVersion(env, t, row.version_no).catch(() => null);
  const latest = await loadVersion(env, t).catch(() => null);
  return {
    template_id: t.id,
    template_name: t.name,
    version_no: row.version_no,
    version_label: installed?.label ?? null,
    latest_version_no: t.current_version_no,
    latest_label: latest?.label ?? null,
    update_available: t.current_version_no > row.version_no,
    install_group: row.install_group,
    setup: installed ? await setupStatus(env, row.workspace_id, installed.manifest, ids) : [],
  };
}

export interface TemplateSetResult {
  installed: InstallResult[];
  failed: Array<{ template_id: string; error: string; code: string }>;
  /** Already installed in the workspace (only with `skipInstalled`). */
  skipped: string[];
}

/**
 * Provisioning hook: install a set of templates into a (new) workspace as `actor`.
 * Picks templates by id, or every instance-library template carrying `tag`. Only
 * templates whose scope reaches the target workspace are installed — never another
 * workspace's private template. One failure never stops the rest.
 */
export async function installTemplateSet(
  env: Env,
  actor: AuthUser,
  opts: { workspaceId: string; templateIds?: string[]; tag?: string; folderId?: string | null; skipInstalled?: boolean },
): Promise<TemplateSetResult> {
  let ids = [...new Set(opts.templateIds ?? [])];
  if (opts.tag) {
    const rows = await env.DB.prepare("SELECT id FROM templates WHERE scope = 'instance' AND current_version_no > 0 AND tags LIKE ? ORDER BY name")
      .bind(`%${JSON.stringify(opts.tag.toLowerCase())}%`).all<{ id: string }>();
    ids = [...new Set([...ids, ...(rows.results || []).map((r) => r.id)])];
  }
  const out: TemplateSetResult = { installed: [], failed: [], skipped: [] };
  // Re-runs (provisioning) leave templates the workspace already has alone.
  if (opts.skipInstalled && ids.length) {
    const have = await env.DB.prepare(`SELECT DISTINCT template_id FROM template_installs WHERE workspace_id = ? AND template_id IN (${ids.map(() => '?').join(',')})`)
      .bind(opts.workspaceId, ...ids).all<{ template_id: string }>();
    const already = new Set((have.results || []).map((r) => r.template_id));
    out.skipped = ids.filter((id) => already.has(id));
    ids = ids.filter((id) => !already.has(id));
  }
  for (const id of ids) {
    try {
      out.installed.push(await installTemplate(env, actor, id, { workspaceId: opts.workspaceId, folderId: opts.folderId ?? null }, { trusted: true }));
    } catch (e) {
      out.failed.push({ template_id: id, error: e instanceof Error ? e.message : 'unknown', code: e instanceof TemplateError ? e.code : 'INSTALL_FAILED' });
    }
  }
  return out;
}
