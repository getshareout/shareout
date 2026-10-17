// In-memory Google Drive and Microsoft Graph, served through a fetch stub. Nothing in
// the file-import tests reaches a real API: any URL these fakes do not know is a 599.

export interface FakeFile {
  id: string;
  name: string;
  parent: string;
  mime: string;
  modifiedTime?: string;
  body?: string;
  folder?: boolean;
}

export interface FakeLog {
  calls: string[];
  downloads: string[];
}

const FOLDER = 'application/vnd.google-apps.folder';

export function gFolder(id: string, name: string, parent: string): FakeFile {
  return { id, name, parent, mime: FOLDER, folder: true };
}

export function gFile(id: string, name: string, parent: string, mime: string, body = `bytes of ${name}`, modifiedTime = '2026-10-01T00:00:00.000Z'): FakeFile {
  return { id, name, parent, mime, body, modifiedTime };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/** Drive v3: files.list (by parent), files.get?alt=media, files.export, drives.list, about. */
export function fakeGoogle(files: FakeFile[], log: FakeLog, opts: { token?: string } = {}) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    log.calls.push(`${init?.method || 'GET'} ${url.pathname}${url.search}`);
    const auth = new Headers(init?.headers).get('Authorization');
    if (url.hostname === 'www.googleapis.com' && auth !== `Bearer ${opts.token || 'at-1'}`) return json({ error: { message: 'bad token' } }, 401);
    if (url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q') || '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const onlyFolders = q.includes(`mimeType = '${FOLDER}'`);
      const rows = files.filter((f) => f.parent === parent && (!onlyFolders || f.folder));
      return json({ files: rows.map((f) => ({ id: f.id, name: f.name, mimeType: f.mime, size: f.body !== undefined ? String(f.body.length) : undefined, modifiedTime: f.modifiedTime })) });
    }
    if (url.pathname === '/drive/v3/drives') return json({ drives: [{ id: 'SD1', name: 'Team drive' }] });
    if (url.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'me@example.com' } });
    const exp = /^\/drive\/v3\/files\/([^/]+)\/export$/.exec(url.pathname);
    if (exp) {
      log.downloads.push(`export:${exp[1]}:${url.searchParams.get('mimeType')}`);
      const f = files.find((x) => x.id === exp[1]);
      return f ? new Response(`exported ${f.name}`, { status: 200 }) : json({ error: { message: 'nf' } }, 404);
    }
    const get = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (get && url.searchParams.get('alt') === 'media') {
      log.downloads.push(`media:${get[1]}`);
      const f = files.find((x) => x.id === get[1]);
      return f ? new Response(f.body ?? '', { status: 200, headers: { 'Content-Length': String((f.body ?? '').length) } }) : json({ error: { message: 'nf' } }, 404);
    }
    return new Response('unexpected request in test', { status: 599 });
  };
}

export interface FakeItem { id: string; name: string; parent: string; folder?: boolean; body?: string; cTag?: string; mime?: string }

/** Graph: /drives/{d}/root|items/{i}/children, /content (302 → pre-authenticated URL), /me/drive. */
export function fakeGraph(items: FakeItem[], log: FakeLog) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    log.calls.push(`${url.hostname}${url.pathname}`);
    if (url.hostname === 'download.example.test') {
      if (new Headers(init?.headers).get('Authorization')) return new Response('token leaked to download host', { status: 400 });
      const f = items.find((x) => x.id === url.pathname.slice(1));
      log.downloads.push(`content:${f?.id}`);
      return new Response(f?.body ?? '', { status: 200 });
    }
    if (url.hostname !== 'graph.microsoft.com') return new Response('unexpected', { status: 599 });
    if (url.pathname === '/v1.0/me/drive') return json({ id: 'DRV1' });
    const ch = /^\/v1\.0\/drives\/([^/]+)\/(?:root|items\/([^/]+))\/children$/.exec(url.pathname);
    if (ch) {
      const parent = ch[2] || 'root';
      return json({
        value: items.filter((i) => i.parent === parent).map((i) => i.folder
          ? { id: i.id, name: i.name, folder: { childCount: 1 } }
          : { id: i.id, name: i.name, size: (i.body ?? '').length, cTag: i.cTag || 'c1', file: { mimeType: i.mime || 'text/plain' } }),
      });
    }
    const content = /^\/v1\.0\/drives\/([^/]+)\/items\/([^/]+)\/content$/.exec(url.pathname);
    if (content) return new Response(null, { status: 302, headers: { Location: `https://download.example.test/${content[2]}` } });
    return new Response('unexpected', { status: 599 });
  };
}
