// Google for Drive-through-sharing tests: the token endpoint, IAM (create / get / delete
// service accounts), IAM Credentials (generateAccessToken) and a Drive that enforces
// ACLs per service account — an item is visible only to the accounts it (or a folder
// above it) was shared with, and anything else is Drive's 404. That is the isolation
// the feature relies on, so the tests exercise it instead of trusting our own checks.

export interface SharedFakeFile {
  id: string;
  name: string;
  parent: string;
  folder?: boolean;
  mime?: string;
  body?: string;
  /** Service-account emails this item is shared with directly. */
  sharedWith?: string[];
}

export interface ShareLog {
  created: string[];
  deleted: string[];
  minted: string[];
  drive: string[];
}

export interface ShareFakeOpts {
  /** Answer a create with this instead of creating (e.g. the project's limit). */
  createFails?: (accountId: string) => Response | null;
  /** Accounts that exist at Google before the test. */
  accounts?: Set<string>;
}

const FOLDER = 'application/vnd.google-apps.folder';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function testMinterKey(project = 'so-test-proj'): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer);
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({ type: 'service_account', project_id: project, client_email: `minter@${project}.iam.gserviceaccount.com`, private_key: pem });
}

export function fakeGoogleShare(files: SharedFakeFile[], log: ShareLog, opts: ShareFakeOpts = {}) {
  const accounts = opts.accounts ?? new Set<string>();
  const byId = { get: (id: string) => files.find((f) => f.id === id) };
  const visible = (id: string, email: string): boolean => {
    for (let f = byId.get(id), hops = 0; f && hops < 50; f = byId.get(f.parent), hops++) {
      if (f.sharedWith?.includes(email)) return true;
    }
    return false;
  };
  const meta = (f: SharedFakeFile) => ({ id: f.id, name: f.name, mimeType: f.folder ? FOLDER : (f.mime || 'text/plain'), modifiedTime: '2026-11-01T00:00:00.000Z', size: f.body !== undefined ? String(f.body.length) : undefined });

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method || 'GET';
    const auth = new Headers(init?.headers).get('Authorization') || '';
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(String(init?.body)).get('assertion') || '';
      return assertion.split('.').length === 3 ? json({ access_token: 'minter-tok', expires_in: 3600 }) : json({ error: 'invalid_grant' }, 400);
    }
    if (url.hostname === 'iam.googleapis.com' || url.hostname === 'iamcredentials.googleapis.com') {
      if (auth !== 'Bearer minter-tok') return json({ error: { message: 'unauthenticated' } }, 401);
      const create = /^\/v1\/projects\/([^/]+)\/serviceAccounts$/.exec(url.pathname);
      if (create && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { accountId: string };
        const fail = opts.createFails?.(body.accountId);
        if (fail) return fail;
        const email = `${body.accountId}@${decodeURIComponent(create[1])}.iam.gserviceaccount.com`;
        if (accounts.has(email)) return json({ error: { status: 'ALREADY_EXISTS', message: 'exists' } }, 409);
        accounts.add(email);
        log.created.push(email);
        return json({ email, uniqueId: `1${log.created.length}`.padEnd(21, '0') });
      }
      const one = /^\/v1\/projects\/-\/serviceAccounts\/([^/:]+)$/.exec(url.pathname);
      if (one) {
        const email = decodeURIComponent(one[1]);
        if (method === 'DELETE') {
          if (!accounts.delete(email)) return json({ error: { message: 'nf' } }, 404);
          log.deleted.push(email);
          return json({});
        }
        return accounts.has(email) ? json({ email, uniqueId: '100000000000000000000' }) : json({ error: { message: 'nf' } }, 404);
      }
      const mint = /^\/v1\/projects\/-\/serviceAccounts\/([^/:]+):generateAccessToken$/.exec(url.pathname);
      if (mint && method === 'POST') {
        const email = decodeURIComponent(mint[1]);
        if (!accounts.has(email)) return json({ error: { message: 'nf' } }, 404);
        log.minted.push(email);
        return json({ accessToken: `tok:${email}`, expireTime: new Date(Date.now() + 3600_000).toISOString() });
      }
      return new Response('unexpected IAM request in test', { status: 599 });
    }
    if (url.hostname === 'www.googleapis.com') {
      const email = auth.startsWith('Bearer tok:') ? auth.slice('Bearer tok:'.length) : '';
      if (!email || !accounts.has(email)) return json({ error: { message: 'bad token' } }, 401);
      log.drive.push(`${email} ${method} ${url.pathname}${url.search}`);
      if (url.pathname === '/drive/v3/files') {
        const q = url.searchParams.get('q') || '';
        const onlyFolders = q.includes(`mimeType = '${FOLDER}'`);
        const parent = /'([^']+)' in parents/.exec(q)?.[1];
        const rows = q.startsWith('sharedWithMe')
          ? files.filter((f) => f.sharedWith?.includes(email))
          : parent && visible(parent, email) ? files.filter((f) => f.parent === parent) : [];
        return json({ files: rows.filter((f) => !onlyFolders || f.folder).map(meta) });
      }
      const get = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
      if (get) {
        const f = byId.get(decodeURIComponent(get[1]));
        if (!f || !visible(f.id, email)) return json({ error: { message: 'File not found.' } }, 404);
        if (url.searchParams.get('alt') === 'media') return new Response(f.body ?? '', { status: 200, headers: { 'Content-Length': String((f.body ?? '').length) } });
        return json(meta(f));
      }
    }
    return new Response('unexpected request in test', { status: 599 });
  };
}
