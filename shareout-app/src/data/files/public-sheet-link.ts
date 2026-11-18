/**
 * A spreadsheet shared as "Anyone with the link can view" → its bytes, with no Google
 * sign-in (the public-link dataset sync). The pasted link is never fetched: only its file id
 * is kept, and ShareOut builds Google's own export URL from it. Requests go to Google's hosts
 * over https only, redirects are followed by hand and only inside the allow-list, and size
 * and time are capped. A link that is not public fails with a message saying how to share it.
 *
 * Google's behaviour, checked 2026-11-18 with anonymous requests against real files:
 * - Sheets: docs.google.com/spreadsheets/d/<id>/export?format=xlsx → 307 to
 *   doc-NN-xx-sheets.googleusercontent.com → 200 xlsx with every tab and the title in
 *   Content-Disposition. Not shared: 401. Deleted: 410. Unknown id: 404.
 * - Drive file (an uploaded .xlsx): drive.google.com/uc?export=download&id=<id> → 303 to
 *   drive.usercontent.google.com/download → 200. Not shared: 302 to accounts.google.com.
 *   A native Google Sheet there: 404. Too big to virus-scan: 200 with an HTML warning page.
 */
import { XLSX_MAX_INPUT_BYTES } from './parse-xlsx';

export type PublicLinkErrorCode =
  | 'BAD_LINK' | 'NOT_PUBLIC' | 'NOT_FOUND' | 'NOT_SPREADSHEET' | 'TOO_LARGE' | 'TIMEOUT' | 'BLOCKED' | 'UPSTREAM';

export class PublicLinkError extends Error {
  constructor(public code: PublicLinkErrorCode, message: string) {
    super(message);
  }
}

export interface ShareLink {
  /** sheets = a native Google Sheet (exported as .xlsx); drive = a file uploaded to Drive. */
  kind: 'sheets' | 'drive';
  id: string;
  /** Older link-shared files need it next to the id. */
  resourceKey?: string;
}

export interface PublicSheetFile {
  bytes: Uint8Array;
  /** From Google's Content-Disposition; null when it sent none. */
  fileName: string | null;
}

export const PUBLIC_LINK_MAX_CHARS = 2000;
export const PUBLIC_FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const FILE_ID = /^[A-Za-z0-9_-]{20,100}$/;
const RESOURCE_KEY = /^[A-Za-z0-9_-]{1,100}$/;

export const SHARING_HOWTO = 'In Google: Share → General access → "Anyone with the link" → Viewer. The link stays the same.';

/** Where the export bytes may come from. Google serves Sheets exports from per-document
 *  hosts (doc-08-4o-sheets.googleusercontent.com); older Drive downloads used …-docs. */
const EXACT_HOSTS = new Set(['docs.google.com', 'drive.google.com', 'drive.usercontent.google.com']);
const CONTENT_HOST = /^doc-[a-z0-9]{1,4}-[a-z0-9]{1,4}-(?:sheets|docs)\.googleusercontent\.com$/;
/** A redirect here means "sign in first": the file is not shared with anyone who has the link. */
const LOGIN_HOSTS = new Set(['accounts.google.com']);

export function isAllowedFetchUrl(u: URL): boolean {
  return u.protocol === 'https:' && !u.username && !u.password && u.port === ''
    && (EXACT_HOSTS.has(u.hostname) || CONTENT_HOST.test(u.hostname));
}

const badLink = (msg: string) => new PublicLinkError('BAD_LINK', msg);

/** A pasted share link → which file it names. Throws BAD_LINK with what to paste instead. */
export function parseShareLink(input: string): ShareLink {
  const raw = String(input ?? '').trim();
  if (!raw) throw badLink('Paste the share link of a Google Sheet or an Excel file in Google Drive.');
  if (raw.length > PUBLIC_LINK_MAX_CHARS) throw badLink('That link is too long to be a Google share link.');
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); } catch {
    throw badLink('That doesn’t look like a link. Copy it from Share → Copy link in Google.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw badLink('Paste a docs.google.com or drive.google.com link.');
  const host = u.hostname.toLowerCase();
  const rk = u.searchParams.get('resourcekey');
  const resourceKey = rk && RESOURCE_KEY.test(rk) ? rk : undefined;
  const out = (kind: ShareLink['kind'], id: string | null | undefined): ShareLink | null =>
    id && FILE_ID.test(id) ? { kind, id, ...(resourceKey ? { resourceKey } : {}) } : null;
  const path = u.pathname.replace(/\/u\/\d+(?=\/)/, '');

  if (host === 'docs.google.com') {
    const m = /^\/spreadsheets\/d\/([^/]+)/.exec(path);
    if (m && m[1] === 'e') throw badLink('That is a "Publish to the web" link. In Google Sheets use Share → Copy link instead.');
    const link = out('sheets', m?.[1]);
    if (link) return link;
    if (/^\/(document|presentation|forms|drawings)\//.test(path)) throw badLink('That link is not a spreadsheet. Paste the link of a Google Sheet or an Excel file.');
    throw badLink('That Google link doesn’t name a spreadsheet. Copy it from Share → Copy link.');
  }
  if (host === 'drive.google.com') {
    if (/^\/drive\/(u\/\d+\/)?folders\//.test(u.pathname)) throw badLink('That is a folder link. Share the spreadsheet itself and paste its link.');
    const m = /^\/file\/d\/([^/]+)/.exec(path);
    const link = out('drive', m?.[1] ?? ((path === '/open' || path === '/uc') ? u.searchParams.get('id') : null));
    if (link) return link;
    throw badLink('That Drive link doesn’t name a file. Copy it from Share → Copy link.');
  }
  throw badLink('Paste a Google Sheets or Google Drive share link (docs.google.com or drive.google.com).');
}

/** The URL ShareOut downloads from — always built here, never the pasted link. */
export function exportUrl(link: ShareLink): string {
  const rk = link.resourceKey ? `&resourcekey=${encodeURIComponent(link.resourceKey)}` : '';
  return link.kind === 'sheets'
    ? `https://docs.google.com/spreadsheets/d/${link.id}/export?format=xlsx${rk}`
    : `https://drive.google.com/uc?export=download&id=${link.id}${rk}`;
}

/** `attachment; filename="A.xlsx"; filename*=UTF-8''A%20b.xlsx` → "A b.xlsx". */
export function dispositionFileName(header: string | null): string | null {
  if (!header) return null;
  let name: string | null = null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) { try { name = decodeURIComponent(star[1].trim()); } catch { /* fall back to filename= */ } }
  if (!name) { const m = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/.exec(header); name = m ? (m[1] ?? m[2] ?? '').trim() : null; }
  const clean = (name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return clean || null;
}

async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

const notPublic = () => new PublicLinkError('NOT_PUBLIC',
  `This file isn’t shared with "Anyone with the link", so ShareOut can’t read it. ${SHARING_HOWTO}`);
const tooLarge = (max: number) => new PublicLinkError('TOO_LARGE', `Spreadsheets up to ${max / 1_000_000} MB can be synced.`);

interface FetchOpts { maxBytes?: number; timeoutMs?: number }

async function download(start: string, signal: AbortSignal, maxBytes: number): Promise<PublicSheetFile> {
  let url = new URL(start);
  for (let hop = 0; ; hop++) {
    if (!isAllowedFetchUrl(url)) throw new PublicLinkError('BLOCKED', 'Google sent the download somewhere ShareOut doesn’t fetch from.');
    const res = await fetch(url.href, { redirect: 'manual', signal, headers: { Accept: '*/*' } });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      const loc = res.headers.get('Location');
      if (!loc) throw new PublicLinkError('UPSTREAM', `Google answered ${res.status} without saying where the file is.`);
      const next = new URL(loc, url);
      if (LOGIN_HOSTS.has(next.hostname)) throw notPublic();
      if (hop >= MAX_REDIRECTS) throw new PublicLinkError('UPSTREAM', 'Google redirected too many times. Try again later.');
      url = next;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      if (res.status === 401 || res.status === 403) throw notPublic();
      if (res.status === 404 || res.status === 410) {
        throw new PublicLinkError('NOT_FOUND', 'Google can’t find this file. Check that the link is complete and the file wasn’t deleted.');
      }
      if (res.status === 429) throw new PublicLinkError('UPSTREAM', 'Google is limiting downloads of this file right now. The next run tries again.');
      throw new PublicLinkError('UPSTREAM', `Google could not send the file (HTTP ${res.status}). The next run tries again.`);
    }
    if ((res.headers.get('Content-Type') || '').toLowerCase().startsWith('text/html')) {
      await res.body?.cancel().catch(() => {});
      throw new PublicLinkError('NOT_SPREADSHEET',
        'Google sent a web page instead of the file. Files too large for Google to scan, and files that are not spreadsheets, can’t be synced from a link.');
    }
    const len = Number(res.headers.get('Content-Length') || 0);
    if (len > maxBytes) { await res.body?.cancel().catch(() => {}); throw tooLarge(maxBytes); }
    const bytes = res.body ? await readCapped(res.body, maxBytes) : new Uint8Array(0);
    if (!bytes) throw tooLarge(maxBytes);
    return { bytes, fileName: dispositionFileName(res.headers.get('Content-Disposition')) };
  }
}

/** Download the spreadsheet a public link names. Throws PublicLinkError with a plain message. */
export async function fetchPublicSheet(link: ShareLink, opts: FetchOpts = {}): Promise<PublicSheetFile> {
  const maxBytes = opts.maxBytes ?? XLSX_MAX_INPUT_BYTES;
  const timeoutMs = opts.timeoutMs ?? PUBLIC_FETCH_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    try {
      return await download(exportUrl(link), signal, maxBytes);
    } catch (e) {
      // A drive.google.com/open?id= link can name a native Google Sheet, which Drive's download answers with 404.
      if (link.kind === 'drive' && e instanceof PublicLinkError && e.code === 'NOT_FOUND') {
        return await download(exportUrl({ ...link, kind: 'sheets' }), signal, maxBytes);
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof PublicLinkError) throw e;
    const name = (e as { name?: string } | null)?.name;
    if (signal.aborted || name === 'TimeoutError' || name === 'AbortError') {
      throw new PublicLinkError('TIMEOUT', `Google took more than ${Math.round(timeoutMs / 1000)} seconds to send the file. The next run tries again.`);
    }
    throw new PublicLinkError('UPSTREAM', 'Google could not be reached. The next run tries again.');
  }
}
