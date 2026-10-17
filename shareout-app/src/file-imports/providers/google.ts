/**
 * Google Drive API v3, read-only (drive.readonly). My Drive, shared drives and
 * "Shared with me" are all reachable; listings pass supportsAllDrives so shared-drive
 * items come back.
 *   https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
 *   https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get
 *   https://developers.google.com/workspace/drive/api/reference/rest/v3/drives/list
 *   https://developers.google.com/workspace/drive/api/guides/enable-shareddrives
 */
import type { BrowseEntry, BrowseResult, ProviderApi, RemoteDownload, RemoteEntry, RemoteListing, RemoteLocation } from '../types';
import { AuthExpiredError, fetchWithBackoff, getJson } from '../http';
import { GOOGLE_FOLDER_MIME, planGoogleFile } from '../export-map';

const API = 'https://www.googleapis.com/drive/v3';
const ID = /^[A-Za-z0-9_-]{1,200}$/;
const FILE_FIELDS = 'nextPageToken,files(id,name,mimeType,size,modifiedTime)';

interface DriveFile { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }
interface FileList { files?: DriveFile[]; nextPageToken?: string }
interface DriveList { drives?: Array<{ id: string; name: string }>; nextPageToken?: string }

function q(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function listUrl(query: string, driveId: string | null, pageToken?: string, fields = FILE_FIELDS): string {
  const p = new URLSearchParams({
    q: query, fields, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', orderBy: 'folder,name',
  });
  if (driveId) { p.set('corpora', 'drive'); p.set('driveId', driveId); }
  if (pageToken) p.set('pageToken', pageToken);
  return `${API}/files?${p}`;
}

function toEntry(f: DriveFile): RemoteEntry {
  const folder = f.mimeType === GOOGLE_FOLDER_MIME;
  return {
    id: f.id, name: f.name, kind: folder ? 'folder' : 'file', mime: f.mimeType,
    size: f.size !== undefined ? Number(f.size) : undefined,
    version: f.modifiedTime,
  };
}

async function folderRows(token: string, query: string, driveId: string | null, refDrive: string): Promise<BrowseEntry[]> {
  const out: BrowseEntry[] = [];
  let page: string | undefined;
  do {
    const r = await getJson<FileList>(listUrl(`${query} and mimeType = '${GOOGLE_FOLDER_MIME}' and trashed = false`, driveId, page, 'nextPageToken,files(id,name)'), token);
    for (const f of r.files || []) out.push({ ref: `folder:${refDrive}:${f.id}`, name: f.name, kind: 'folder', selectable: true });
    page = r.nextPageToken;
  } while (page && out.length < 1000);
  return out;
}

export const googleDrive: ProviderApi = {
  id: 'google_drive',

  async listChildren(token: string, loc: RemoteLocation, pageToken?: string): Promise<RemoteListing> {
    if (!ID.test(loc.folderId) && loc.folderId !== 'root') throw new Error('bad folder id');
    const r = await getJson<FileList>(listUrl(`'${q(loc.folderId)}' in parents and trashed = false`, loc.driveId, pageToken), token);
    return { entries: (r.files || []).map(toEntry), next: r.nextPageToken };
  },

  async download(token: string, _driveId: string | null, entry: RemoteEntry): Promise<RemoteDownload> {
    const plan = planGoogleFile(entry.name, entry.mime);
    if (plan.kind === 'skip') return { ok: false, code: plan.code, message: plan.message };
    const url = plan.kind === 'export'
      ? `${API}/files/${encodeURIComponent(entry.id)}/export?mimeType=${encodeURIComponent(plan.target.mime)}`
      : `${API}/files/${encodeURIComponent(entry.id)}?alt=media&supportsAllDrives=true`;
    const res = await fetchWithBackoff(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) throw new AuthExpiredError();
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: { message?: string; errors?: Array<{ reason?: string }> } } | null;
      const reason = body?.error?.errors?.[0]?.reason || '';
      if (reason === 'exportSizeLimitExceeded') return { ok: false, code: 'EXPORT_TOO_LARGE', message: 'Google only exports documents up to 10 MB. Download it as a file from Drive and upload it.' };
      if (reason === 'cannotDownloadFile' || reason === 'fileNotDownloadable') return { ok: false, code: 'DOWNLOAD_RESTRICTED', message: 'The owner turned off downloading for this file.' };
      if (res.status === 404) return { ok: false, code: 'NOT_FOUND', message: 'The file is gone or no longer shared with you.' };
      return { ok: false, code: 'DOWNLOAD_FAILED', message: body?.error?.message?.slice(0, 200) || `Drive answered HTTP ${res.status}.` };
    }
    const len = Number(res.headers.get('Content-Length'));
    const size = plan.kind === 'download' && entry.size !== undefined ? entry.size : Number.isFinite(len) && len > 0 ? len : null;
    return {
      ok: true,
      filename: plan.kind === 'export' ? plan.filename : entry.name,
      mime: plan.kind === 'export' ? plan.target.mime : (entry.mime || 'application/octet-stream'),
      size,
      body: res.body ?? new Response(new Uint8Array(0)).body!,
    };
  },

  async browse(token: string, ref: string): Promise<BrowseResult> {
    if (ref === 'root') {
      const entries: BrowseEntry[] = [
        { ref: 'my', name: 'My Drive', kind: 'drive', selectable: true },
        { ref: 'shared', name: 'Shared with me', kind: 'group', selectable: false },
      ];
      let page: string | undefined;
      do {
        const p = new URLSearchParams({ pageSize: '100', fields: 'nextPageToken,drives(id,name)' });
        if (page) p.set('pageToken', page);
        const r = await getJson<DriveList>(`${API}/drives?${p}`, token);
        for (const d of r.drives || []) entries.push({ ref: `drive:${d.id}`, name: d.name, kind: 'drive', selectable: true });
        page = r.nextPageToken;
      } while (page && entries.length < 500);
      return { entries };
    }
    if (ref === 'my') return { entries: await folderRows(token, "'root' in parents", null, '-') };
    if (ref === 'shared') return { entries: await folderRows(token, 'sharedWithMe', null, '-') };
    const loc = await this.locate(token, ref);
    if (!loc) return { entries: [] };
    return { entries: await folderRows(token, `'${q(loc.folderId)}' in parents`, loc.driveId, loc.driveId ?? '-') };
  },

  async locate(_token: string, ref: string): Promise<RemoteLocation | null> {
    if (ref === 'my') return { driveId: null, folderId: 'root' };
    let m = /^drive:([^:]+)$/.exec(ref);
    if (m && ID.test(m[1])) return { driveId: m[1], folderId: m[1] };
    m = /^folder:([^:]+):([^:]+)$/.exec(ref);
    if (m && (m[1] === '-' || ID.test(m[1])) && ID.test(m[2])) return { driveId: m[1] === '-' ? null : m[1], folderId: m[2] };
    return null;
  },
};
