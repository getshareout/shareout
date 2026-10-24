// Per-artifact email opt-out (G15): signed token, one-click route, and sendArtifactEmail honouring it.
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { createFetchContext } from '../../../src/router/context';
import { routeEmail } from '../../../src/email/routes';
import { createArtifactOptoutToken, verifyArtifactOptoutToken, optedOutSet } from '../../../src/email/artifact-optout';
import { createUnsubscribeToken } from '../../../src/email/unsubscribe-token';
import { handleEmail } from '../../../src/data/email/handler';
import type { DataContext } from '../../../src/data/middleware';
import { sendArtifactEmail } from '../../../src/scheduling/email';

const e = env as unknown as Env;
Object.assign(e, { SESSION_SECRET: 'test-session-secret', SHAREOUT_BASE_URL: 'https://shareout.site' });

const sent: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, workspace_id TEXT, owner_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, locale TEXT)`,
    `CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT, channel TEXT, slug TEXT, version_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifact_emails (artifact_id TEXT PRIMARY KEY, email_prefix TEXT, reply_to TEXT)`,
    `CREATE TABLE IF NOT EXISTS email_suppressions (email TEXT PRIMARY KEY, user_id TEXT, reason TEXT, kind TEXT, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifact_email_optouts (artifact_id TEXT NOT NULL, email TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (artifact_id, email))`,
  ]) await e.DB.exec(sql);
});

beforeEach(async () => {
  for (const t of ['artifacts', 'workspaces', 'deployments', 'artifact_emails', 'email_suppressions', 'artifact_email_optouts']) await e.DB.exec(`DELETE FROM ${t}`);
  await e.DB.exec(`INSERT INTO workspaces (id, locale) VALUES ('wsp_es', 'es'), ('wsp_en', 'en')`);
  await e.DB.exec(`INSERT INTO artifacts (id, name, workspace_id) VALUES ('art_es', 'Campo & Co', 'wsp_es'), ('art_en', 'Plain', 'wsp_en')`);
  await e.DB.exec(`INSERT INTO deployments (artifact_id, channel, slug) VALUES ('art_es', 'production', 'campo'), ('art_en', 'production', 'plain')`);
  sent.length = 0;
  (e as unknown as { EMAIL: unknown }).EMAIL = { send: vi.fn(async (m: Record<string, unknown>) => { sent.push(m); return { messageId: `m${sent.length}` }; }) };
});

const ctx = (path: string, init: RequestInit = {}) => createFetchContext(new Request(`https://shareout.site${path}`, init), e);
const route = async (token: string, method = 'GET', body?: string) =>
  (await routeEmail(ctx(`/v1/email/artifact-unsubscribe?token=${encodeURIComponent(token)}`, {
    method, ...(body ? { body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } : {}),
  })))!;

describe('artifact opt-out token', () => {
  it('round-trips and is bound to (artifact, email)', async () => {
    const t = await createArtifactOptoutToken(e, 'art_es', 'Ana@Example.com');
    expect(await verifyArtifactOptoutToken(e, t)).toEqual({ artifactId: 'art_es', email: 'ana@example.com' });
  });

  it('rejects tampering, other secrets, and tokens minted for another purpose', async () => {
    const t = await createArtifactOptoutToken(e, 'art_es', 'a@x.com');
    const [data, sig] = t.split('.');
    const forged = btoa(JSON.stringify({ a: 'art_en', e: 'a@x.com' })).replace(/=+$/, '');
    expect(await verifyArtifactOptoutToken(e, `${forged}.${sig}`)).toBeNull();
    expect(await verifyArtifactOptoutToken(e, `${data}.AAAA`)).toBeNull();
    expect(await verifyArtifactOptoutToken({ ...e, SESSION_SECRET: 'other' } as Env, t)).toBeNull();
    expect(await verifyArtifactOptoutToken(e, await createUnsubscribeToken(e, 'usr_1', 'product'))).toBeNull();
    expect(await verifyArtifactOptoutToken(e, 'garbage')).toBeNull();
  });
});

describe('GET/POST /v1/email/artifact-unsubscribe', () => {
  it('GET only shows a confirmation page (link scanners must not unsubscribe anyone)', async () => {
    const res = await route(await createArtifactOptoutToken(e, 'art_es', 'a@x.com'));
    expect(res.status).toBe(200);
    expect(await e.DB.prepare('SELECT COUNT(*) AS n FROM artifact_email_optouts').first<{ n: number }>()).toEqual({ n: 0 });
    expect(res.headers.get('Location')).toBeNull();
  });

  it('POST (RFC 8058 one-click) stores a per-artifact opt-out and nothing global', async () => {
    const tok = await createArtifactOptoutToken(e, 'art_es', 'A@x.com');
    const res = await route(tok, 'POST', 'List-Unsubscribe=One-Click');
    expect(res.status).toBe(200);
    expect([...(await optedOutSet(e, 'art_es', ['a@x.com']))]).toEqual(['a@x.com']);
    expect((await optedOutSet(e, 'art_en', ['a@x.com'])).size).toBe(0);
    expect(await e.DB.prepare('SELECT COUNT(*) AS n FROM email_suppressions').first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('can opt back in from the same page', async () => {
    const tok = await createArtifactOptoutToken(e, 'art_es', 'a@x.com');
    await route(tok, 'POST', 'List-Unsubscribe=One-Click');
    await route(tok, 'POST', 'action=resubscribe');
    expect((await optedOutSet(e, 'art_es', ['a@x.com'])).size).toBe(0);
  });

  it('is localized from the artifact workspace (es vs en) and escapes the artifact name', async () => {
    const es = await (await route(await createArtifactOptoutToken(e, 'art_es', 'a@x.com'))).text();
    expect(es).toContain('<html lang="es-AR">');
    expect(es).toContain('Darte de baja');
    expect(es).toContain('Campo &amp; Co');
    const en = await (await route(await createArtifactOptoutToken(e, 'art_en', 'a@x.com'))).text();
    expect(en).toContain('<html lang="en">');
    expect(en).toContain('Unsubscribe');
  });

  it('answers a bad or foreign token with the same generic 400 and stores nothing', async () => {
    const res = await route('nope.nope', 'POST', 'List-Unsubscribe=One-Click');
    expect(res.status).toBe(400);
    const missing = await route(await createArtifactOptoutToken(e, 'art_missing', 'a@x.com'), 'POST', 'List-Unsubscribe=One-Click');
    expect(missing.status).toBe(400);
    expect(await e.DB.prepare('SELECT COUNT(*) AS n FROM artifact_email_optouts').first<{ n: number }>()).toEqual({ n: 0 });
  });
});

describe('malicious artifact name', () => {
  const EVIL = '<img src=x onerror=alert(document.cookie)>"\'';
  it('is HTML-escaped on every state of the page (GET, POST done, POST resubscribe)', async () => {
    await e.DB.exec(`INSERT INTO artifacts (id, name, workspace_id) VALUES ('art_evil', '${EVIL.replace(/'/g, "''")}', 'wsp_es')`);
    await e.DB.exec(`INSERT INTO deployments (artifact_id, channel, slug) VALUES ('art_evil', 'production', 'evil')`);
    const tok = await createArtifactOptoutToken(e, 'art_evil', 'a@x.com');
    const bodies = [
      await (await route(tok)).text(),
      await (await route(tok, 'POST', 'action=unsubscribe')).text(),
      await (await route(tok)).text(), // now shows the already-unsubscribed state
      await (await route(tok, 'POST', 'action=resubscribe')).text(),
    ];
    for (const b of bodies) {
      expect(b).not.toContain('<img');
      expect(b).not.toContain('onerror=alert(document.cookie)>');
    }
    for (const i of [0, 1, 3]) expect(bodies[i]).toContain('&lt;img src=x');
    // English workspace too.
    await e.DB.exec(`UPDATE artifacts SET workspace_id = 'wsp_en' WHERE id = 'art_evil'`);
    expect(await (await route(tok)).text()).not.toContain('<img');
  });

  it('does not put the raw name into the email body or its footer', async () => {
    await e.DB.exec(`INSERT INTO artifacts (id, name, workspace_id) VALUES ('art_evil2', '<script>alert(1)</script>', 'wsp_es')`);
    await e.DB.exec(`INSERT INTO deployments (artifact_id, channel, slug) VALUES ('art_evil2', 'production', 'evil2')`);
    await sendArtifactEmail(e, 'art_evil2', { recipients: ['a@x.com'], subject: 's' });
    const html = (sent[0] as { html: string }).html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('sendArtifactEmail honours the per-artifact opt-out', () => {
  it('skips opted-out recipients, reports them, and sends each other recipient their own link + RFC 8058 headers', async () => {
    await e.DB.exec(`INSERT INTO artifact_email_optouts (artifact_id, email) VALUES ('art_es', 'gone@x.com')`);
    const r = await sendArtifactEmail(e, 'art_es', { recipients: ['Gone@x.com', 'a@x.com', 'b@x.com'], subject: 'Resumen', html: '<p>hola</p>', body: 'hola' });
    expect(r.success).toBe(true);
    expect(r.skippedOptedOut).toEqual(['gone@x.com']);
    expect(r.recipients).toBe(2);
    expect(sent).toHaveLength(2);
    const [m1, m2] = sent as Array<{ to: string; html: string; text: string; headers: Record<string, string> }>;
    expect(m1.to).toBe('a@x.com');
    expect(m1.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const link = /<(https:\/\/shareout\.site\/v1\/email\/artifact-unsubscribe\?token=[^>]+)>/.exec(m1.headers['List-Unsubscribe'])![1];
    expect(m1.html).toContain(link.replace(/&/g, '&amp;'));
    expect(m1.html).toContain('Darte de baja');
    expect(m1.text).toContain(link);
    expect(m2.headers['List-Unsubscribe']).not.toBe(m1.headers['List-Unsubscribe']);
    const tok = new URL(link).searchParams.get('token')!;
    expect(await verifyArtifactOptoutToken(e, tok)).toEqual({ artifactId: 'art_es', email: 'a@x.com' });
  });

  it('a text-only email gets no HTML part (else clients show only the footer)', async () => {
    const r = await sendArtifactEmail(e, 'art_es', { recipients: ['a@x.com'], subject: 's', body: 'hola' });
    expect(r.success).toBe(true);
    const m = sent[0] as { html?: string; text: string; headers: Record<string, string> };
    expect(m.html).toBeUndefined();
    expect(m.text).toMatch(/^hola\n\n--\n.*Darte de baja: https:/s);
    expect(m.headers['List-Unsubscribe']).toContain('artifact-unsubscribe');
  });

  it('sends nothing and says why when everyone opted out', async () => {
    await e.DB.exec(`INSERT INTO artifact_email_optouts (artifact_id, email) VALUES ('art_en', 'a@x.com')`);
    const r = await sendArtifactEmail(e, 'art_en', { recipients: ['a@x.com'], subject: 's', body: 'x' });
    expect(r.success).toBe(false);
    expect(r.skippedOptedOut).toEqual(['a@x.com']);
    expect(sent).toHaveLength(0);
  });

  it('an opt-out on one artifact does not affect another', async () => {
    await e.DB.exec(`INSERT INTO artifact_email_optouts (artifact_id, email) VALUES ('art_es', 'a@x.com')`);
    const r = await sendArtifactEmail(e, 'art_en', { recipients: ['a@x.com'], subject: 's', body: 'x' });
    expect(r.success).toBe(true);
    expect(r.skippedOptedOut ?? []).toEqual([]);
  });
});

describe('owner view of opt-outs', () => {
  const call = async (isOwner: boolean) => {
    const dctx = { artifactId: 'art_es', env: e, origin: null, isOwner } as unknown as DataContext;
    return handleEmail(new Request('https://x/v1/data/art_es/email/optouts'), dctx, '/optouts');
  };
  it('lists opted-out addresses for the owner and refuses everyone else', async () => {
    await e.DB.exec(`INSERT INTO artifact_email_optouts (artifact_id, email) VALUES ('art_es', 'gone@x.com')`);
    const ok = await call(true);
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).toContain('gone@x.com');
    expect((await call(false)).status).toBe(403);
  });
});
