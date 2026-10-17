/**
 * Mapping the remote tree onto ShareOut: who may import, the mirrored Team Space
 * folders, the visibility imported things take from the target folder, and filenames
 * the blob store accepts.
 */
import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { membersCanCreateFolders } from '../folders';
import { normalizeVisibility } from '../visibility-config';
import { validateFilename } from '../data/blobs/handler';

/**
 * Importing creates Team Space folders and files, so it takes what creating a folder
 * takes: workspace owners and admins always, plain internal members while the workspace
 * lets members create folders. External members (viewers) never.
 */
export async function canImport(env: Env, workspaceId: string, userId: string): Promise<boolean> {
  const role = await getInternalWorkspaceRole(env, workspaceId, userId);
  if (role === 'owner' || role === 'admin') return true;
  return role === 'member' && (await membersCanCreateFolders(env, workspaceId));
}

export type Audience = 'private' | 'workspace' | 'public';

/** The target folder's resolved visibility (`inherit` walks up; none set = workspace). */
export async function targetAudience(env: Env, workspaceId: string, folderId: string | null): Promise<Audience> {
  if (!folderId) return 'workspace';
  const chain = (await env.DB.prepare(`
    WITH RECURSIVE anc(id, visibility, parent_id, depth) AS (
      SELECT id, visibility, parent_id, 0 FROM folders WHERE id = ? AND workspace_id = ?
      UNION ALL
      SELECT f.id, f.visibility, f.parent_id, anc.depth + 1 FROM folders f JOIN anc ON f.id = anc.parent_id WHERE anc.depth < 32
    )
    SELECT visibility FROM anc ORDER BY depth
  `).bind(folderId, workspaceId).all<{ visibility: string | null }>()).results || [];
  const setBy = chain.find((f) => f.visibility && f.visibility !== 'inherit');
  const v = setBy ? normalizeVisibility(setBy.visibility!) : 'workspace';
  return v === 'public' || v === 'private' ? v : 'workspace';
}

/** File visibility for that audience. Files never go public: a public folder's files
 *  get the link-shareable setting, a private folder's stay private, else team-only. */
export function fileVisibility(a: Audience): 'private' | 'team' | 'workspace' {
  return a === 'private' ? 'private' : a === 'public' ? 'workspace' : 'team';
}

/** Page visibility. Never public from an import: publishing publicly has its own
 *  approval policy, which a bulk sync must not route around. */
export function pageVisibility(a: Audience): 'private' | 'workspace' {
  return a === 'private' ? 'private' : 'workspace';
}

function slugify(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30).replace(/-$/, '') || 'folder';
}

/**
 * The ShareOut folder a remote folder maps to: the one recorded last time if it still
 * exists in this workspace, else a new one under `parentId` with a free slug.
 */
export async function ensureMirrorFolder(
  env: Env, workspaceId: string, userId: string, parentId: string | null, name: string, existingId: string | null,
): Promise<string> {
  if (existingId) {
    const row = await env.DB.prepare('SELECT id FROM folders WHERE id = ? AND workspace_id = ?').bind(existingId, workspaceId).first();
    if (row) return existingId;
  }
  const base = slugify(name);
  for (let n = 1; n <= 50; n++) {
    const slug = n === 1 ? base : `${base.slice(0, 26)}-${n}`;
    const taken = await env.DB.prepare(
      'SELECT id FROM folders WHERE workspace_id = ? AND slug = ? AND IFNULL(parent_id, \'~\') = IFNULL(?, \'~\')',
    ).bind(workspaceId, slug, parentId).first();
    if (taken) continue;
    const id = generateId('fld');
    await env.DB.prepare(
      "INSERT INTO folders (id, workspace_id, name, slug, parent_id, visibility, created_by) VALUES (?, ?, ?, ?, ?, 'inherit', ?)",
    ).bind(id, workspaceId, name.trim().slice(0, 200) || 'Folder', slug, parentId, userId).run();
    return id;
  }
  throw new Error('could not allocate a folder slug');
}

const KEEP = /[^a-zA-Z0-9_\-.()[\] ]+/g;

/**
 * A filename the blob store accepts (letters, digits, space, _-.()[]), keeping the
 * extension. Accents are folded (`Presupuesto año.xlsx` → `Presupuesto ano.xlsx`); the
 * original name stays the file's display name.
 */
export function storableFilename(name: string): string {
  const folded = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const dot = folded.lastIndexOf('.');
  const rawExt = dot > 0 ? folded.slice(dot + 1) : '';
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  const stem = (dot > 0 ? folded.slice(0, dot) : folded)
    .replace(KEEP, '-').replace(/\.{2,}/g, '.').replace(/-{2,}/g, '-').replace(/^[-. ]+|[-. ]+$/g, '').slice(0, 200) || 'file';
  return ext ? `${stem}.${ext}` : stem;
}

/** null when storable; else the reason, with blocked types told apart. */
export function filenameProblem(filename: string): { code: 'BLOCKED_TYPE' | 'INVALID_FILE'; message: string } | null {
  const err = validateFilename(filename);
  if (!err) return null;
  return err === 'File type not allowed'
    ? { code: 'BLOCKED_TYPE', message: 'Scripts, web pages and programs are not stored as workspace files.' }
    : { code: 'INVALID_FILE', message: err };
}
