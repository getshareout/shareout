/**
 * Microsoft Graph v1.0, delegated: the signed-in member's OneDrive and the SharePoint
 * document libraries they can open (site → drive → folder). Downloads go through the
 * item's /content redirect to a short-lived pre-authenticated URL, fetched without our
 * bearer token.
 *   https://learn.microsoft.com/en-us/graph/api/driveitem-list-children
 *   https://learn.microsoft.com/en-us/graph/api/driveitem-get-content
 *   https://learn.microsoft.com/en-us/graph/api/site-search
 *   https://learn.microsoft.com/en-us/graph/api/drive-list
 *   https://learn.microsoft.com/en-us/graph/api/user-list-followedsites
 */
import type { BrowseEntry, BrowseResult, ProviderApi, RemoteDownload, RemoteEntry, RemoteListing, RemoteLocation } from '../types';
import { AuthExpiredError, fetchWithBackoff, getJson } from '../http';

export const GRAPH = 'https://graph.microsoft.com/v1.0';
const ID = /^[A-Za-z0-9!_.,-]{1,300}$/;
const ITEM_SELECT = 'id,name,size,file,folder,package,cTag,eTag';

interface DriveItem {
  id: string; name: string; size?: number; cTag?: string; eTag?: string;
  file?: { mimeType?: string }; folder?: { childCount?: number }; package?: { type?: string };
}
interface Page<T> { value?: T[]; '@odata.nextLink'?: string }

function childrenUrl(loc: RemoteLocation): string {
  const d = encodeURIComponent(loc.driveId || '');
  const base = loc.folderId === 'root' ? `${GRAPH}/drives/${d}/root/children` : `${GRAPH}/drives/${d}/items/${encodeURIComponent(loc.folderId)}/children`;
  return `${base}?$top=200&$select=${ITEM_SELECT}`;
}

function toEntry(i: DriveItem): RemoteEntry {
  if (i.folder) return { id: i.id, name: i.name, kind: 'folder' };
  // OneNote notebooks are packages: a folder-shaped thing with no downloadable bytes.
  const mime = i.package ? `package/${i.package.type || 'unknown'}` : i.file?.mimeType || 'application/octet-stream';
  return { id: i.id, name: i.name, kind: 'file', mime, size: i.size, version: i.cTag || i.eTag };
}

async function myDriveId(token: string): Promise<string> {
  return (await getJson<{ id: string }>(`${GRAPH}/me/drive?$select=id`, token)).id;
}

async function folderRows(token: string, loc: RemoteLocation): Promise<BrowseEntry[]> {
  const out: BrowseEntry[] = [];
  let url: string | undefined = childrenUrl(loc);
  while (url && out.length < 1000) {
    const r: Page<DriveItem> = await getJson<Page<DriveItem>>(url, token);
    for (const i of r.value || []) if (i.folder) out.push({ ref: `folder:${loc.driveId}:${i.id}`, name: i.name, kind: 'folder', selectable: true });
    url = safeNext(r['@odata.nextLink']);
  }
  return out;
}

function safeNext(next: string | undefined): string | undefined {
  return next && next.startsWith(`${GRAPH}/`) ? next : undefined;
}

export const microsoftGraph: ProviderApi = {
  id: 'microsoft',

  async listChildren(token: string, loc: RemoteLocation, pageToken?: string): Promise<RemoteListing> {
    if (!loc.driveId || !ID.test(loc.driveId) || (loc.folderId !== 'root' && !ID.test(loc.folderId))) throw new Error('bad location');
    const url = (pageToken && safeNext(pageToken)) || childrenUrl(loc);
    const r = await getJson<Page<DriveItem>>(url, token);
    return { entries: (r.value || []).map(toEntry), next: safeNext(r['@odata.nextLink']) };
  },

  async download(token: string, driveId: string | null, entry: RemoteEntry): Promise<RemoteDownload> {
    if (entry.mime?.startsWith('package/')) {
      return { ok: false, code: 'NOT_EXPORTABLE', message: 'OneNote notebooks can’t be downloaded as a file. Export them from OneNote first.' };
    }
    const url = `${GRAPH}/drives/${encodeURIComponent(driveId || '')}/items/${encodeURIComponent(entry.id)}/content`;
    let res = await fetchWithBackoff(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' });
    if (res.status === 401) throw new AuthExpiredError();
    const location = res.headers.get('Location');
    if (res.status >= 300 && res.status < 400 && location) {
      // Pre-authenticated, short-lived URL: never send our token to it.
      res = await fetchWithBackoff(location, {});
    }
    if (res.status === 404) return { ok: false, code: 'NOT_FOUND', message: 'The file is gone or no longer shared with you.' };
    if (!res.ok) return { ok: false, code: 'DOWNLOAD_FAILED', message: `Microsoft answered HTTP ${res.status}.` };
    return {
      ok: true,
      filename: entry.name,
      mime: entry.mime || 'application/octet-stream',
      size: entry.size ?? null,
      body: res.body ?? new Response(new Uint8Array(0)).body!,
    };
  },

  async browse(token: string, ref: string, query?: string): Promise<BrowseResult> {
    if (ref === 'root') {
      const entries: BrowseEntry[] = [{ ref: 'me', name: 'My files (OneDrive)', kind: 'drive', selectable: true }];
      const term = (query || '').trim().slice(0, 100);
      const sites = term
        ? await getJson<Page<{ id: string; displayName?: string; name?: string }>>(`${GRAPH}/sites?search=${encodeURIComponent(term)}&$select=id,displayName,name`, token)
        // Personal accounts have no SharePoint: no followed sites is not an error.
        : await getJson<Page<{ id: string; displayName?: string; name?: string }>>(`${GRAPH}/me/followedSites?$select=id,displayName,name`, token).catch((e) => {
          if (e instanceof AuthExpiredError) throw e;
          return { value: [] };
        });
      for (const s of sites.value || []) {
        if (ID.test(s.id)) entries.push({ ref: `site:${s.id}`, name: s.displayName || s.name || s.id, kind: 'site', selectable: false });
      }
      return { entries, searchable: true };
    }
    if (ref === 'me') return { entries: await folderRows(token, { driveId: await myDriveId(token), folderId: 'root' }) };
    const site = /^site:([^:]+)$/.exec(ref);
    if (site && ID.test(site[1])) {
      const r = await getJson<Page<{ id: string; name: string }>>(`${GRAPH}/sites/${encodeURIComponent(site[1])}/drives?$select=id,name`, token);
      return { entries: (r.value || []).filter((d) => ID.test(d.id)).map((d) => ({ ref: `drive:${d.id}`, name: d.name, kind: 'drive' as const, selectable: true })) };
    }
    const loc = await this.locate(token, ref);
    return { entries: loc ? await folderRows(token, loc) : [] };
  },

  async locate(token: string, ref: string): Promise<RemoteLocation | null> {
    if (ref === 'me') return { driveId: await myDriveId(token), folderId: 'root' };
    let m = /^drive:([^:]+)$/.exec(ref);
    if (m && ID.test(m[1])) return { driveId: m[1], folderId: 'root' };
    m = /^folder:([^:]+):([^:]+)$/.exec(ref);
    if (m && ID.test(m[1]) && ID.test(m[2])) return { driveId: m[1], folderId: m[2] };
    return null;
  },
};
