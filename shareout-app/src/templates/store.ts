/**
 * Template rows, versions and their R2 bytes, plus who may see, install and manage them.
 *
 * Visibility follows scope:
 *   private  — installs into its home workspace (or, saved from a personal space, only
 *              into its creator's personal space)
 *   shared   — private, plus every workspace in template_shares
 *   instance — every workspace on the instance; only platform admins publish here
 */
import type { Env, FileEntry } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { isPlatformAdmin } from '../superadmin/auth';
import { TemplateError } from './errors';
import type { Snapshot } from './snapshot';
import { LIMITS, type TemplateItem, type TemplateManifest, type TemplateRow, type TemplateScope } from './types';

export const fileKey = (templateId: string, versionNo: number, itemKey: string, path: string) =>
  `templates/${templateId}/${versionNo}/${itemKey}/${path}`;
const previewKey = (templateId: string) => `templates/${templateId}/preview`;

const SEMVER = /^\d+\.\d+\.\d+$/;

export async function isAdmin(env: Env, user: AuthUser): Promise<boolean> {
  if (user.service) return false;
  return isPlatformAdmin(env, user.email, user.id);
}

export async function getTemplate(env: Env, id: string): Promise<TemplateRow | null> {
  return env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first<TemplateRow>();
}

async function sharedWith(env: Env, templateId: string): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT workspace_id FROM template_shares WHERE template_id = ?').bind(templateId).all<{ workspace_id: string }>();
  return (rows.results || []).map((r) => r.workspace_id);
}

/** Whether the template's scope lets it install into `target` (null = personal space). Membership is the caller's check. */
export async function scopeAllows(env: Env, t: TemplateRow, target: string | null, userId: string): Promise<boolean> {
  if (t.scope === 'instance') return true;
  if (target === null) return t.workspace_id === null && t.created_by === userId;
  if (t.workspace_id === target) return true;
  if (t.scope !== 'shared') return false;
  return !!(await env.DB.prepare('SELECT 1 FROM template_shares WHERE template_id = ? AND workspace_id = ?').bind(t.id, target).first());
}

export async function canManage(env: Env, user: AuthUser, t: TemplateRow): Promise<boolean> {
  if (await isAdmin(env, user)) return true;
  if (t.scope === 'instance') return false;
  if (t.created_by === user.id) {
    return t.workspace_id ? !!(await getInternalWorkspaceRole(env, t.workspace_id, user.id)) : true;
  }
  if (!t.workspace_id) return false;
  const role = await getInternalWorkspaceRole(env, t.workspace_id, user.id);
  return role === 'owner' || role === 'admin';
}

export async function canSee(env: Env, user: AuthUser, t: TemplateRow): Promise<boolean> {
  if (t.scope === 'instance' && t.current_version_no > 0) return true;
  if (await canManage(env, user, t)) return true;
  if (t.workspace_id ? !!(await getInternalWorkspaceRole(env, t.workspace_id, user.id)) : t.created_by === user.id) return true;
  if (t.scope !== 'shared') return false;
  for (const ws of await sharedWith(env, t.id)) {
    if (await getInternalWorkspaceRole(env, ws, user.id)) return true;
  }
  return false;
}

export interface ListFilter { workspaceId: string | null; q?: string | null; tag?: string | null; scope?: TemplateScope | null }

/** Templates installable in one context (a workspace the caller is a member of, or their personal space). */
export async function listTemplates(env: Env, user: AuthUser, f: ListFilter): Promise<TemplateRow[]> {
  const where: string[] = ['t.current_version_no > 0'];
  const binds: unknown[] = [];
  if (f.workspaceId) {
    where.push(`(t.scope = 'instance' OR t.workspace_id = ? OR (t.scope = 'shared' AND EXISTS (SELECT 1 FROM template_shares s WHERE s.template_id = t.id AND s.workspace_id = ?)))`);
    binds.push(f.workspaceId, f.workspaceId);
  } else {
    where.push(`(t.scope = 'instance' OR (t.workspace_id IS NULL AND t.created_by = ?))`);
    binds.push(user.id);
  }
  if (f.scope) { where.push('t.scope = ?'); binds.push(f.scope); }
  if (f.q) { where.push('(t.name LIKE ? OR t.description LIKE ? OR t.tags LIKE ?)'); const q = `%${f.q.replace(/[%_]/g, '')}%`; binds.push(q, q, q); }
  if (f.tag) { where.push('t.tags LIKE ?'); binds.push(`%${JSON.stringify(f.tag.toLowerCase())}%`); }
  const rows = await env.DB.prepare(`SELECT t.* FROM templates t WHERE ${where.join(' AND ')}
    ORDER BY CASE t.scope WHEN 'instance' THEN 1 ELSE 0 END, t.updated_at DESC LIMIT 200`).bind(...binds).all<TemplateRow>();
  return rows.results || [];
}

export function parseTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter((x) => x && x.length <= 32))].slice(0, LIMITS.tags);
}

export interface TemplateMeta {
  name: string;
  description: string | null;
  tags: string[];
  scope: TemplateScope;
  versionLabel: string | null;
  notes: string | null;
  sharedWorkspaceIds: string[];
  previewImage: string | null;
}

function nextLabel(prev: string | null): string {
  if (!prev || !SEMVER.test(prev)) return '1.0.0';
  const [a, b] = prev.split('.').map(Number);
  return `${a}.${b + 1}.0`;
}

async function putBlobs(env: Env, templateId: string, versionNo: number, snap: Snapshot): Promise<void> {
  for (const it of snap.manifest.items) {
    for (const f of it.files) {
      const body = snap.blobs.get(`${it.key}/${f.path}`);
      if (body === undefined) continue;
      await env.ARTIFACTS.put(fileKey(templateId, versionNo, it.key, f.path), body, { httpMetadata: { contentType: f.mime } });
    }
  }
}

async function putPreview(env: Env, templateId: string, dataUrl: string | null): Promise<{ key: string; mime: string } | null> {
  if (!dataUrl) return null;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new TemplateError('VALIDATION_ERROR', 400, 'preview_image must be a PNG, JPEG or WebP data URL');
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.byteLength > 1024 * 1024) throw new TemplateError('TOO_LARGE', 413, 'preview_image can be up to 1 MB');
  await env.ARTIFACTS.put(previewKey(templateId), bytes, { httpMetadata: { contentType: m[1] } });
  return { key: previewKey(templateId), mime: m[1] };
}

export async function validateShares(env: Env, user: AuthUser, ids: string[], admin: boolean): Promise<string[]> {
  const unique = [...new Set(ids.filter((x) => typeof x === 'string' && x))].slice(0, 100);
  for (const ws of unique) {
    const exists = await env.DB.prepare('SELECT 1 FROM workspaces WHERE id = ?').bind(ws).first();
    // Sharing into a workspace you are not in would hand its members content on your say-so alone.
    if (!exists || (!admin && !(await getInternalWorkspaceRole(env, ws, user.id)))) {
      throw new TemplateError('FORBIDDEN', 403, `You can only share a template with workspaces you belong to (${ws})`);
    }
  }
  return unique;
}

async function writeShares(env: Env, user: AuthUser, templateId: string, ids: string[]): Promise<void> {
  await env.DB.prepare('DELETE FROM template_shares WHERE template_id = ?').bind(templateId).run();
  for (const ws of ids) {
    await env.DB.prepare('INSERT INTO template_shares (template_id, workspace_id, created_by) VALUES (?, ?, ?)').bind(templateId, ws, user.id).run();
  }
}

export async function createTemplate(env: Env, user: AuthUser, snap: Snapshot, source: { kind: 'artifact' | 'folder'; id: string }, meta: TemplateMeta): Promise<TemplateRow> {
  const id = generateId('tpl');
  const now = new Date().toISOString();
  const label = meta.versionLabel ?? '1.0.0';
  await env.DB.prepare(`INSERT INTO templates (id, workspace_id, scope, name, description, tags, source_kind, source_id, current_version_no, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
    .bind(id, snap.workspaceId, meta.scope, meta.name, meta.description, JSON.stringify(meta.tags), source.kind, source.id, user.id, now, now).run();
  await putBlobs(env, id, 1, snap);
  const preview = await putPreview(env, id, meta.previewImage);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO template_versions (id, template_id, version_no, version_label, manifest_json, notes, size_bytes, created_by, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)')
      .bind(generateId('tpv'), id, label, JSON.stringify(snap.manifest), meta.notes, snap.totalBytes, user.id, now),
    env.DB.prepare('UPDATE templates SET current_version_no = 1, preview_r2_key = ?, preview_mime = ? WHERE id = ?')
      .bind(preview?.key ?? null, preview?.mime ?? null, id),
  ]);
  if (meta.scope === 'shared') await writeShares(env, user, id, meta.sharedWorkspaceIds);
  return (await getTemplate(env, id))!;
}

/** A new version from a fresh snapshot. Installed copies see "update available". */
export async function addVersion(env: Env, user: AuthUser, t: TemplateRow, snap: Snapshot, opts: { versionLabel: string | null; notes: string | null }): Promise<TemplateRow> {
  const prev = await env.DB.prepare('SELECT version_label FROM template_versions WHERE template_id = ? AND version_no = ?')
    .bind(t.id, t.current_version_no).first<{ version_label: string }>();
  const label = opts.versionLabel ?? nextLabel(prev?.version_label ?? null);
  const no = t.current_version_no + 1;
  const now = new Date().toISOString();
  await putBlobs(env, t.id, no, snap);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO template_versions (id, template_id, version_no, version_label, manifest_json, notes, size_bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(generateId('tpv'), t.id, no, label, JSON.stringify(snap.manifest), opts.notes, snap.totalBytes, user.id, now),
      env.DB.prepare('UPDATE templates SET current_version_no = ?, updated_at = ? WHERE id = ? AND current_version_no = ?').bind(no, now, t.id, t.current_version_no),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new TemplateError('CONFLICT', 409, 'Someone saved a version at the same moment. Try again.');
    throw err;
  }
  return (await getTemplate(env, t.id))!;
}

export async function updateMeta(env: Env, user: AuthUser, t: TemplateRow, patch: Partial<TemplateMeta>, admin: boolean): Promise<TemplateRow> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); binds.push(patch.name); }
  if (patch.description !== undefined) { sets.push('description = ?'); binds.push(patch.description); }
  if (patch.tags !== undefined) { sets.push('tags = ?'); binds.push(JSON.stringify(patch.tags)); }
  if (patch.scope !== undefined) {
    if ((patch.scope === 'instance' || t.scope === 'instance') && patch.scope !== t.scope && !admin) {
      throw new TemplateError('FORBIDDEN', 403, 'Only instance admins can publish to or remove from the instance library');
    }
    sets.push('scope = ?'); binds.push(patch.scope);
  }
  if (patch.previewImage) {
    const p = await putPreview(env, t.id, patch.previewImage);
    sets.push('preview_r2_key = ?', 'preview_mime = ?'); binds.push(p?.key ?? null, p?.mime ?? null);
  }
  if (sets.length) {
    sets.push('updated_at = ?'); binds.push(new Date().toISOString());
    await env.DB.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, t.id).run();
  }
  if (patch.sharedWorkspaceIds !== undefined) await writeShares(env, user, t.id, patch.sharedWorkspaceIds);
  return (await getTemplate(env, t.id))!;
}

export async function deleteTemplate(env: Env, t: TemplateRow): Promise<void> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.ARTIFACTS.list({ prefix: `templates/${t.id}/`, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (keys.length) await env.ARTIFACTS.delete(keys);
  await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(t.id).run();
}

export async function loadVersion(env: Env, t: TemplateRow, versionNo = t.current_version_no): Promise<{ versionNo: number; label: string; notes: string | null; createdAt: string; manifest: TemplateManifest }> {
  const row = await env.DB.prepare('SELECT version_no, version_label, notes, manifest_json, created_at FROM template_versions WHERE template_id = ? AND version_no = ?')
    .bind(t.id, versionNo).first<{ version_no: number; version_label: string; notes: string | null; manifest_json: string; created_at: string }>();
  if (!row) throw new TemplateError('NOT_FOUND', 404, 'Template version not found');
  return { versionNo: row.version_no, label: row.version_label, notes: row.notes, createdAt: row.created_at, manifest: JSON.parse(row.manifest_json) as TemplateManifest };
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** An item's files as stored (text still carries its link tokens). */
export async function loadItemFiles(env: Env, templateId: string, versionNo: number, item: TemplateItem): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  for (const f of item.files) {
    const obj = await env.ARTIFACTS.get(fileKey(templateId, versionNo, item.key, f.path));
    if (!obj) throw new TemplateError('TEMPLATE_INCOMPLETE', 500, `Template file ${f.path} is missing`);
    out.push(f.text
      ? { path: f.path, content: await obj.text(), mime: f.mime, encoding: 'utf8' }
      : { path: f.path, content: toBase64(new Uint8Array(await obj.arrayBuffer())), mime: f.mime, encoding: 'base64' });
  }
  return out;
}

export async function readPreviewImage(env: Env, t: TemplateRow): Promise<R2ObjectBody | null> {
  return t.preview_r2_key ? env.ARTIFACTS.get(t.preview_r2_key) : null;
}

export function tagsOf(t: TemplateRow): string[] {
  try { const v = JSON.parse(t.tags); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

export { sharedWith };
