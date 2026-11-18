// A public Google share link → the spreadsheet's bytes, no sign-in. The pasted URL is never
// fetched; only Google's hosts over https, redirects inside the allow-list, size and time capped.
// Google is a fetch stub shaped on what real anonymous requests returned (2026-11-18).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PublicLinkError, dispositionFileName, exportUrl, fetchPublicSheet, isAllowedFetchUrl, parseShareLink,
} from '../../../src/data/files/public-sheet-link';

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const XID = '1_VTWRhrTKaNvMlR0UH-WZcWJibu1QwLt';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]);

type Hop = { status: number; location?: string; type?: string; body?: BodyInit | null; headers?: Record<string, string> };
let seen: Array<{ url: string; redirect?: RequestRedirect }> = [];

function stub(routes: Record<string, Hop | (() => Hop | Promise<Response>)>) {
  seen = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, redirect: init?.redirect });
    const r = routes[url];
    if (!r) return new Response('unexpected request in test: ' + url, { status: 599 });
    const hop = typeof r === 'function' ? await r() : r;
    if (hop instanceof Response) return hop;
    const headers: Record<string, string> = { ...(hop.headers ?? {}) };
    if (hop.location) headers.Location = hop.location;
    if (hop.type) headers['Content-Type'] = hop.type;
    return new Response(hop.body ?? null, { status: hop.status, headers });
  }));
}
afterEach(() => vi.unstubAllGlobals());

const SHEET_EXPORT = `https://docs.google.com/spreadsheets/d/${ID}/export?format=xlsx`;
const SHEET_CDN = `https://doc-08-4o-sheets.googleusercontent.com/export/abc/def/1795007700000/100630705629414352418/*/${ID}?format=xlsx`;
const DRIVE_UC = `https://drive.google.com/uc?export=download&id=${XID}`;
const DRIVE_DL = `https://drive.usercontent.google.com/download?id=${XID}&export=download`;

async function failsWith(p: Promise<unknown>, code: string): Promise<string> {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(PublicLinkError);
    expect((e as PublicLinkError).code).toBe(code);
    return (e as Error).message;
  }
  throw new Error(`expected ${code}`);
}

describe('parseShareLink', () => {
  it('reads the file id from the links people actually paste', () => {
    expect(parseShareLink(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toEqual({ kind: 'sheets', id: ID });
    expect(parseShareLink(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toEqual({ kind: 'sheets', id: ID });
    expect(parseShareLink(`docs.google.com/spreadsheets/u/1/d/${ID}/htmlview`)).toEqual({ kind: 'sheets', id: ID });
    expect(parseShareLink(`  https://drive.google.com/file/d/${XID}/view?usp=drive_link  `)).toEqual({ kind: 'drive', id: XID });
    expect(parseShareLink(`https://drive.google.com/open?id=${XID}`)).toEqual({ kind: 'drive', id: XID });
    expect(parseShareLink(`https://drive.google.com/uc?export=download&id=${XID}`)).toEqual({ kind: 'drive', id: XID });
    expect(parseShareLink(`https://drive.google.com/file/d/${XID}/view?resourcekey=0-abcDEF_12`)).toEqual({ kind: 'drive', id: XID, resourceKey: '0-abcDEF_12' });
  });

  it('refuses anything that is not a Google spreadsheet link, saying what to paste', () => {
    for (const bad of [
      '', 'not a link', 'https://evil.example/spreadsheets/d/' + ID, 'https://docs.google.com.evil.example/spreadsheets/d/' + ID,
      `https://sheets.googleusercontent.com/spreadsheets/d/${ID}`, `ftp://docs.google.com/spreadsheets/d/${ID}`,
      `https://docs.google.com/document/d/${ID}/edit`, 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQabcdefghijklmnopqrstuvwxyz/pubhtml',
      `https://drive.google.com/drive/folders/${XID}`, 'https://docs.google.com/spreadsheets/d/short/edit', 'x'.repeat(2001),
    ]) {
      expect(() => parseShareLink(bad), bad).toThrow(PublicLinkError);
    }
    expect(() => parseShareLink('https://docs.google.com/spreadsheets/d/e/2PACX-1vQabcdefghijklmnopqrstuvwxyz/pubhtml')).toThrow(/Publish to the web/);
    expect(() => parseShareLink(`https://drive.google.com/drive/folders/${XID}`)).toThrow(/folder/);
  });

  it('builds Google’s export URL from the id alone', () => {
    expect(exportUrl({ kind: 'sheets', id: ID })).toBe(SHEET_EXPORT);
    expect(exportUrl({ kind: 'drive', id: XID })).toBe(DRIVE_UC);
    expect(exportUrl({ kind: 'drive', id: XID, resourceKey: '0-k' })).toBe(`${DRIVE_UC}&resourcekey=0-k`);
  });
});

describe('isAllowedFetchUrl', () => {
  it('only Google’s export hosts, over https, no credentials or ports', () => {
    for (const ok of [SHEET_EXPORT, SHEET_CDN, DRIVE_UC, DRIVE_DL, 'https://doc-0k-bc-docs.googleusercontent.com/docs/x']) expect(isAllowedFetchUrl(new URL(ok)), ok).toBe(true);
    for (const no of [
      SHEET_EXPORT.replace('https:', 'http:'), 'https://evil.example/x', 'https://lh3.googleusercontent.com/x', 'https://googleusercontent.com/x',
      'https://doc-08-4o-sheets.googleusercontent.com.evil.example/x', 'https://user:pw@docs.google.com/x', 'https://docs.google.com:8443/x',
      'https://169.254.169.254/latest/meta-data', 'https://localhost/x', 'https://accounts.google.com/ServiceLogin',
    ]) expect(isAllowedFetchUrl(new URL(no)), no).toBe(false);
  });
});

describe('dispositionFileName', () => {
  it('prefers the UTF-8 name and strips control characters', () => {
    expect(dispositionFileName(`attachment; filename="ExampleSpreadsheet.xlsx"; filename*=UTF-8''Example%20Spreadsheet.xlsx`)).toBe('Example Spreadsheet.xlsx');
    expect(dispositionFileName('attachment; filename="data_LDV3.xlsx"')).toBe('data_LDV3.xlsx');
    expect(dispositionFileName('attachment; filename="a\u0007b.xlsx"')).toBe('ab.xlsx');
    expect(dispositionFileName(null)).toBeNull();
  });
});

describe('fetchPublicSheet', () => {
  it('a public Google Sheet: 307 to the per-document host, then the xlsx with its title', async () => {
    stub({
      [SHEET_EXPORT]: { status: 307, location: SHEET_CDN, type: 'application/binary' },
      [SHEET_CDN]: { status: 200, type: XLSX_MIME, body: bytes, headers: { 'Content-Disposition': `attachment; filename="ExampleSpreadsheet.xlsx"; filename*=UTF-8''Example%20Spreadsheet.xlsx` } },
    });
    const f = await fetchPublicSheet({ kind: 'sheets', id: ID });
    expect(Array.from(f.bytes)).toEqual(Array.from(bytes));
    expect(f.fileName).toBe('Example Spreadsheet.xlsx');
    // Redirects are followed by hand, so each hop is checked against the allow-list.
    expect(seen).toEqual([{ url: SHEET_EXPORT, redirect: 'manual' }, { url: SHEET_CDN, redirect: 'manual' }]);
  });

  it('an Excel file in Drive: 303 to drive.usercontent, then the bytes', async () => {
    stub({
      [DRIVE_UC]: { status: 303, location: DRIVE_DL },
      [DRIVE_DL]: { status: 200, type: 'application/octet-stream', body: bytes, headers: { 'Content-Disposition': 'attachment; filename="data_LDV3.xlsx"' } },
    });
    expect((await fetchPublicSheet({ kind: 'drive', id: XID })).fileName).toBe('data_LDV3.xlsx');
  });

  it('a Drive link that names a native Google Sheet falls back to the Sheets export', async () => {
    const SX = `https://docs.google.com/spreadsheets/d/${XID}/export?format=xlsx`;
    stub({
      [DRIVE_UC]: { status: 303, location: DRIVE_DL },
      [DRIVE_DL]: { status: 404, type: 'text/html; charset=utf-8', body: '<html>not found</html>' },
      [SX]: { status: 200, type: XLSX_MIME, body: bytes },
    });
    expect((await fetchPublicSheet({ kind: 'drive', id: XID })).bytes.byteLength).toBe(bytes.byteLength);
    expect(seen.map((s) => s.url)).toEqual([DRIVE_UC, DRIVE_DL, SX]);
  });

  it('not shared publicly: a plain message that says how to change sharing', async () => {
    stub({ [SHEET_EXPORT]: { status: 401, type: 'text/html; charset=utf-8', body: '<html>sign in</html>' } });
    const msg = await failsWith(fetchPublicSheet({ kind: 'sheets', id: ID }), 'NOT_PUBLIC');
    expect(msg).toMatch(/Anyone with the link/);
    expect(msg).toMatch(/Share → General access/);

    // Drive answers a private file by sending you to sign in; that redirect is never followed.
    stub({
      [DRIVE_UC]: { status: 303, location: DRIVE_DL },
      [DRIVE_DL]: { status: 302, location: `https://accounts.google.com/ServiceLogin?service=wise&continue=${encodeURIComponent(DRIVE_DL)}` },
    });
    await failsWith(fetchPublicSheet({ kind: 'drive', id: XID }), 'NOT_PUBLIC');
    expect(seen.map((s) => s.url)).toEqual([DRIVE_UC, DRIVE_DL]);
  });

  it('deleted or unknown files say so', async () => {
    stub({ [SHEET_EXPORT]: { status: 410 } });
    await failsWith(fetchPublicSheet({ kind: 'sheets', id: ID }), 'NOT_FOUND');
    stub({ [SHEET_EXPORT]: { status: 404 } });
    await failsWith(fetchPublicSheet({ kind: 'sheets', id: ID }), 'NOT_FOUND');
  });

  it('never follows a redirect out of the allow-list (other hosts, http, internal addresses)', async () => {
    for (const loc of ['https://evil.example/x.xlsx', SHEET_CDN.replace('https:', 'http:'), 'http://169.254.169.254/latest/meta-data/', 'https://127.0.0.1/x', '//evil.example/x']) {
      stub({ [SHEET_EXPORT]: { status: 307, location: loc } });
      await failsWith(fetchPublicSheet({ kind: 'sheets', id: ID }), 'BLOCKED');
      expect(seen).toHaveLength(1);
    }
  });

  it('stops after five redirects', async () => {
    const loop = `${SHEET_CDN}&n=1`;
    stub({ [SHEET_EXPORT]: { status: 307, location: loop }, [loop]: { status: 307, location: loop } });
    await failsWith(fetchPublicSheet({ kind: 'sheets', id: ID }), 'UPSTREAM');
    expect(seen.length).toBe(6);
  });

  it('a web page instead of the file (Drive’s virus-scan warning) is an error, not an empty dataset', async () => {
    stub({ [DRIVE_UC]: { status: 303, location: DRIVE_DL }, [DRIVE_DL]: { status: 200, type: 'text/html; charset=utf-8', body: '<html>Google Drive - Virus scan warning</html>' } });
    await failsWith(fetchPublicSheet({ kind: 'drive', id: XID }), 'NOT_SPREADSHEET');
  });

  it('caps the size, by Content-Length and while streaming', async () => {
    stub({ [SHEET_EXPORT]: { status: 200, type: XLSX_MIME, body: new Uint8Array(10), headers: { 'Content-Length': '999999999' } } });
    await failsWith(fetchPublicSheet({ kind: 'sheets', id: ID }, { maxBytes: 100 }), 'TOO_LARGE');
    const big = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(new Uint8Array(64)); },
    });
    stub({ [SHEET_EXPORT]: () => new Response(big, { status: 200, headers: { 'Content-Type': XLSX_MIME } }) as unknown as Hop });
    await failsWith(fetchPublicSheet({ kind: 'sheets', id: ID }, { maxBytes: 1000 }), 'TOO_LARGE');
  });

  it('caps the time', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(init.signal!.reason ?? new DOMException('aborted', 'AbortError')));
    })));
    const msg = await failsWith(fetchPublicSheet({ kind: 'sheets', id: ID }, { timeoutMs: 30 }), 'TIMEOUT');
    expect(msg).toMatch(/seconds/);
  });

  it('a network failure is a plain error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    await failsWith(fetchPublicSheet({ kind: 'sheets', id: ID }), 'UPSTREAM');
  });
});
