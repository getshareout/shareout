/**
 * Drive reads for folders shared with a workspace's service account: what was shared
 * with it (`sharedWithMe`), one item by id, and pasted Drive links. Listing children
 * and downloading reuse the regular Google provider with the account's token.
 *   https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
 *   https://developers.google.com/workspace/drive/api/guides/search-files
 */
import type { BrowseEntry } from '../types';
import { ProviderError, getJson } from '../http';
import { GOOGLE_FOLDER_MIME } from '../export-map';

const API = 'https://www.googleapis.com/drive/v3';
const ID = /^[A-Za-z0-9_-]{10,200}$/;

export interface SharedItem {
  id: string;
  name: string;
  folder: boolean;
}

/** The Drive id in a pasted folder/file link (or a bare id), or null. */
export function driveIdFromLink(raw: string): string | null {
  const s = raw.trim();
  if (ID.test(s)) return s;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || !/^(drive|docs)\.google\.com$/.test(u.hostname)) return null;
  const m = /\/(?:folders|d)\/([A-Za-z0-9_-]+)/.exec(u.pathname);
  const id = m?.[1] || u.searchParams.get('id') || '';
  return ID.test(id) ? id : null;
}

/** One item the account can see. 404 = not shared with this workspace (or gone). */
export async function sharedItem(token: string, id: string): Promise<SharedItem> {
  if (!ID.test(id)) throw new ProviderError(400, 'VALIDATION_ERROR', 'Not a Google Drive link.');
  const p = new URLSearchParams({ fields: 'id,name,mimeType,trashed', supportsAllDrives: 'true' });
  const f = await getJson<{ id: string; name: string; mimeType: string; trashed?: boolean }>(`${API}/files/${encodeURIComponent(id)}?${p}`, token);
  if (f.trashed) throw new ProviderError(404, 'NOT_FOUND', 'That folder is in the Drive trash.');
  return { id: f.id, name: f.name, folder: f.mimeType === GOOGLE_FOLDER_MIME };
}

/** Folders shared with the account, newest share first — exactly this workspace's shares. */
export async function sharedFolders(token: string): Promise<BrowseEntry[]> {
  const out: BrowseEntry[] = [];
  let page: string | undefined;
  do {
    const p = new URLSearchParams({
      q: `sharedWithMe and mimeType = '${GOOGLE_FOLDER_MIME}' and trashed = false`,
      fields: 'nextPageToken,files(id,name)', pageSize: '200', orderBy: 'sharedWithMeTime desc',
      supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    });
    if (page) p.set('pageToken', page);
    const r = await getJson<{ files?: Array<{ id: string; name: string }>; nextPageToken?: string }>(`${API}/files?${p}`, token);
    for (const f of r.files || []) out.push({ ref: `folder:-:${f.id}`, name: f.name, kind: 'folder', selectable: true });
    page = r.nextPageToken;
  } while (page && out.length < 1000);
  return out;
}
