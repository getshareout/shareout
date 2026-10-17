// One-step customer provisioning (POST /v1/admin/workspaces/provision) against the real
// schema: who may call it, what one call leaves behind, and that a second call with the
// same spec changes nothing.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { id: string; email: string } | null,
  dispatch: vi.fn(),
}));
vi.mock('../../../src/auth/session', async (orig) => ({
  ...(await orig<object>()),
  getSessionUser: async () => h.session,
}));
vi.mock('../../../src/email/gateway', async (orig) => ({
  ...(await orig<object>()),
  dispatchLifecycleEmail: h.dispatch,
}));

import { applyMigrations, e } from '../helpers/migrated-db';
import { createFetchContext } from '../../../src/router/context';
import { routeAdminApi } from '../../../src/router/api/admin';
import { registerProvisionHook, clearProvisionHook } from '../../../src/superadmin/provision/hooks';
import type { Env } from '../../../src/types';

const OPS = { id: 'usr_prov_ops', email: 'ops@example.com' };
const WS_ADMIN = { id: 'usr_prov_wsadmin', email: 'lead@example.com' };
const SECRET = 'sk_live_DO_NOT_ECHO_8f3a';
// 1×1 transparent PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const env = { ...e, INSTANCE_ADMIN_EMAILS: OPS.email, CREDENTIALS_KEY: 'test-credentials-key-0123456789ab' } as Env;

function spec(slug: string, extra: Record<string, unknown> = {}) {
  return {
    name: 'Acme',
    slug,
    locale: 'es',
    admins: [`ana@${slug}.example.com`, `beto@${slug}.example.com`],
    subdomain: true,
    branding: { accent_color: '#1A73E8', logo: { data_base64: PNG_B64, content_type: 'image/png' } },
    policy: {
      allowed_domains: [`${slug}.example.com`],
      external_sharing: false,
      guest_comments: true,
      knowledge: true,
      features: { 'ai.crew': false },
    },
    folders: ['Clientes', 'Proveedores', 'Reportes'],
    connectors: [{ name: 'api', type: 'rest_api', config: { base_url: 'https://api.example.com' }, credentials: { type: 'api_key', data: { api_key: SECRET } } }],
    ...extra,
  };
}

async function provision(body: unknown, as: { id: string; email: string } | null = OPS) {
  h.session = as;
  const req = new Request('https://shareout.test/v1/admin/workspaces/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = (await routeAdminApi(createFetchContext(req, env)))!;
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Record<string, any> };
}

const wsId = async (slug: string) =>
  (await e.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first<{ id: string }>())!.id;
const count = async (sql: string, ...args: unknown[]) =>
  (await e.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?), (?, ?, ?)')
      .bind(OPS.id, OPS.email, 'ops', WS_ADMIN.id, WS_ADMIN.email, 'lead'),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('wsp_prov_own', 'Own', 'prov-own', ?)").bind(WS_ADMIN.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_prov_own', 'wsp_prov_own', ?, 'owner')").bind(WS_ADMIN.id),
  ]);
});

beforeEach(() => {
  h.dispatch.mockReset();
  h.dispatch.mockResolvedValue({ sent: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearProvisionHook('templates');
});

describe('who may provision', () => {
  it('refuses a workspace admin who is not an instance admin', async () => {
    const r = await provision(spec('authz-ws'), WS_ADMIN);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ success: false, code: 'FORBIDDEN' });
    expect(await count('SELECT COUNT(*) AS n FROM workspaces WHERE slug = ?', 'authz-ws')).toBe(0);
  });

  it('refuses an anonymous caller', async () => {
    expect((await provision(spec('authz-anon'), null)).status).toBe(403);
  });
});

describe('a first run', () => {
  let r: Awaited<ReturnType<typeof provision>>;
  let id: string;
  let invitesSent: string[];
  beforeAll(async () => {
    h.dispatch.mockReset();
    h.dispatch.mockResolvedValue({ sent: true });
    r = await provision(spec('acme'));
    id = await wsId('acme');
    invitesSent = h.dispatch.mock.calls.filter(([, m]) => m.type === 'workspace_invite').map(([, m]) => m.toEmail);
  });

  it('creates the workspace with its slug, locale and subdomain', async () => {
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, created: true, workspace: { name: 'Acme', slug: 'acme', locale: 'es' } });
    expect(r.body.links.subdomain).toBe('https://acme.shareout.test/');
    expect(r.body.links.home).toContain(`/home?workspace=${id}`);
    expect(r.body.duration_ms).toBeLessThan(10_000);
    const row = await e.DB.prepare('SELECT locale, subdomain_enabled, owner_id FROM workspaces WHERE id = ?').bind(id).first<any>();
    expect(row).toMatchObject({ locale: 'es', subdomain_enabled: 1 });
  });

  it('applies branding: accent colour and the uploaded logo', async () => {
    const row = await e.DB.prepare('SELECT branding FROM workspaces WHERE id = ?').bind(id).first<{ branding: string }>();
    expect(JSON.parse(row!.branding)).toMatchObject({ accent_color: '#1a73e8', logo_ext: 'png' });
    const obj = await e.ARTIFACTS.get(`workspace-logos/${id}.png`);
    expect(obj).not.toBeNull();
    expect((await obj!.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it('applies policy defaults: domains, flags, knowledge', async () => {
    const row = await e.DB.prepare('SELECT allowed_email_domains, feature_flags FROM workspaces WHERE id = ?').bind(id).first<any>();
    expect(JSON.parse(row.allowed_email_domains)).toEqual(['acme.example.com']);
    expect(JSON.parse(row.feature_flags)).toEqual({ 'ai.crew': false, 'collab.external_sharing': false });
    expect(await count('SELECT COUNT(*) AS n FROM knowledge_settings WHERE workspace_id = ? AND enabled = 1', id)).toBe(1);
  });

  it('creates the starter folders, with guest comments on', async () => {
    const rows = await e.DB.prepare('SELECT name, guest_comments_enabled AS g FROM folders WHERE workspace_id = ? ORDER BY name').bind(id).all<any>();
    expect(rows.results).toEqual([
      { name: 'Clientes', g: 1 }, { name: 'Proveedores', g: 1 }, { name: 'Reportes', g: 1 },
    ]);
  });

  it('makes the first admin the owner and invites every admin by email', async () => {
    expect(r.body.admins).toEqual([
      expect.objectContaining({ email: 'ana@acme.example.com', role: 'owner', status: 'invited', email_sent: true }),
      expect.objectContaining({ email: 'beto@acme.example.com', role: 'admin', status: 'invited', email_sent: true }),
    ]);
    expect(invitesSent.sort()).toEqual(['ana@acme.example.com', 'beto@acme.example.com']);
    expect(await count('SELECT COUNT(*) AS n FROM workspace_invite_claims WHERE workspace_id = ?', id)).toBe(2);
  });

  it('stores the connector encrypted and never echoes or audits the secret', async () => {
    expect(r.body.steps).toContainEqual(expect.objectContaining({ step: 'connector:api', status: 'created' }));
    expect(r.text).not.toContain(SECRET);
    const conn = await e.DB.prepare('SELECT encrypted_credentials FROM connections WHERE scope_id = ? AND name = ?').bind(id, 'api').first<any>();
    expect(conn.encrypted_credentials).not.toContain(SECRET);
    const audit = await e.DB.prepare('SELECT action, detail FROM audit_log WHERE workspace_id = ?').bind(id).all<any>();
    expect(JSON.stringify(audit.results)).not.toContain(SECRET);
  });

  it('writes one audit row per step plus the run', async () => {
    const actions = (await e.DB.prepare('SELECT action FROM audit_log WHERE workspace_id = ? AND actor_email = ?').bind(id, OPS.email).all<any>())
      .results.map((a: any) => a.action);
    for (const a of ['workspace.provision', 'workspace.provision.workspace', 'workspace.provision.branding', 'workspace.provision.policy',
      'workspace.provision.folders', 'workspace.provision.admins', 'workspace.provision.connector']) {
      expect(actions).toContain(a);
    }
  });

  it('leaves the template and custom-domain hooks pending with a next step', async () => {
    const again = await provision(spec('acme', { templates: 'agency-starter', custom_domain: 'reports.acme.example.com' }));
    const steps = again.body.steps as any[];
    expect(steps.find((s) => s.step === 'templates')).toMatchObject({ status: 'pending' });
    expect(steps.find((s) => s.step === 'custom_domain')).toMatchObject({ status: 'pending' });
    expect(again.body.next_steps.join(' ')).toContain('agency-starter');
  });
});

describe('re-running the same spec', () => {
  it('changes nothing and duplicates nothing', async () => {
    await provision(spec('rerun'));
    const id = await wsId('rerun');
    h.dispatch.mockClear();
    const second = await provision(spec('rerun'));

    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    for (const s of second.body.steps as any[]) expect([s.step, s.status]).toEqual([s.step, 'unchanged']);
    expect(second.body.admins.map((a: any) => a.status)).toEqual(['already_invited', 'already_invited']);
    expect(h.dispatch.mock.calls.filter(([, m]) => m.type === 'workspace_invite')).toHaveLength(0);
    expect(await count('SELECT COUNT(*) AS n FROM workspaces WHERE slug = ?', 'rerun')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM folders WHERE workspace_id = ?', id)).toBe(3);
    expect(await count('SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?', id)).toBe(2);
    expect(await count('SELECT COUNT(*) AS n FROM workspace_invite_claims WHERE workspace_id = ?', id)).toBe(2);
    expect(await count('SELECT COUNT(*) AS n FROM connections WHERE scope_id = ?', id)).toBe(1);
  });

  it('fills in only what is missing when the spec grows', async () => {
    await provision(spec('grow', { folders: ['Clientes'], connectors: [] }));
    const r = await provision(spec('grow', { folders: ['Clientes', 'Reportes'], connectors: [], admins: ['ana@grow.example.com', 'cora@grow.example.com'] }));
    const folders = (r.body.steps as any[]).find((s) => s.step === 'folders');
    expect(folders).toMatchObject({ status: 'created', detail: { created: ['Reportes'], existing: ['Clientes'] } });
    expect(r.body.admins.map((a: any) => [a.email, a.status])).toEqual([
      ['ana@grow.example.com', 'already_invited'], ['cora@grow.example.com', 'invited'],
    ]);
  });

  it('refuses to adopt a slug owned by a differently named workspace unless told to', async () => {
    await provision(spec('taken'));
    const other = await provision({ ...spec('taken'), name: 'Globex' });
    expect(other.status).toBe(409);
    expect(other.body).toMatchObject({ success: false, code: 'SLUG_TAKEN', param: 'slug' });
    const adopt = await provision({ ...spec('taken'), name: 'Globex', if_exists: 'update' });
    expect(adopt.status).toBe(200);
    expect(adopt.body.workspace.name).toBe('Globex');
  });

  it('runs a registered template hook instead of leaving it pending', async () => {
    const hook = vi.fn(async () => ({ status: 'created' as const, detail: { installed: 2 } }));
    registerProvisionHook('templates', hook);
    const r = await provision(spec('hooked', { templates: 'starter' }));
    expect(hook).toHaveBeenCalledWith(expect.objectContaining({ workspace: expect.objectContaining({ slug: 'hooked' }) }), 'starter');
    expect((r.body.steps as any[]).find((s) => s.step === 'templates')).toMatchObject({ status: 'created', detail: { installed: 2 } });
  });
});

describe('partial failure', () => {
  it('reports the failed steps with 207 and still finishes the rest', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const r = await provision(spec('partial', {
      branding: { accent_color: '#000000', logo: { url: 'https://cdn.example.com/acme.png' } },
      connectors: [
        { name: 'bad', type: 'not-a-type', credentials: { type: 'api_key', data: { api_key: SECRET } } },
        { name: 'good', type: 'rest_api', credentials: { type: 'api_key', data: { api_key: SECRET } } },
      ],
    }));
    expect(r.status).toBe(207);
    expect(r.body.ok).toBe(false);
    const steps = r.body.steps as any[];
    expect(steps.find((s) => s.step === 'branding')).toMatchObject({ status: 'failed', error: expect.stringContaining('404') });
    expect(steps.find((s) => s.step === 'connector:bad')).toMatchObject({ status: 'failed' });
    expect(steps.find((s) => s.step === 'connector:good')).toMatchObject({ status: 'created' });
    expect(steps.find((s) => s.step === 'folders')).toMatchObject({ status: 'created' });
    expect(r.body.admins.every((a: any) => a.status === 'invited')).toBe(true);
    expect(r.body.next_steps.some((n: string) => n.includes('connector:bad'))).toBe(true);
    expect(r.text).not.toContain(SECRET);
  });

  it('says when an invite email did not go out, with the link to send by hand', async () => {
    h.dispatch.mockResolvedValue({ sent: false, skipped: 'no_binding' });
    const r = await provision(spec('nomail', { connectors: [], branding: null }));
    const ana = r.body.admins[0];
    expect(ana).toMatchObject({ status: 'invited', email_sent: false });
    expect(ana.invite_url).toMatch(/\/invite\//);
    expect(r.body.next_steps.join(' ')).toContain(ana.invite_url);
  });
});

describe('validation', () => {
  const bad = async (body: unknown) => (await provision(body)).body;

  it('rejects bad and reserved slugs', async () => {
    expect(await bad({ ...spec('x'), slug: 'Not Valid' })).toMatchObject({ code: 'INVALID_SLUG', param: 'slug' });
    expect(await bad({ ...spec('x'), slug: 'a' })).toMatchObject({ code: 'INVALID_SLUG' });
    expect(await bad({ ...spec('x'), slug: 'admin' })).toMatchObject({ code: 'SLUG_RESERVED' });
    expect(await bad({ ...spec('x'), slug: undefined })).toMatchObject({ code: 'VALIDATION_ERROR', param: 'slug' });
  });

  it('rejects bad emails and admins the policy would refuse', async () => {
    expect(await bad({ ...spec('val'), admins: ['not-an-email'] })).toMatchObject({ code: 'INVALID_EMAIL' });
    expect(await bad({ ...spec('val'), admins: ['ana@elsewhere.example.org'] })).toMatchObject({ code: 'ADMIN_OUTSIDE_POLICY' });
    expect(await bad({ ...spec('val'), admins: [] })).toMatchObject({ code: 'VALIDATION_ERROR', param: 'admins' });
  });

  it('rejects a logo of the wrong type or size', async () => {
    const big = btoa('x'.repeat(600 * 1024));
    expect(await bad({ ...spec('val'), branding: { logo: { data_base64: big, content_type: 'image/png' } } })).toMatchObject({ code: 'LOGO_TOO_LARGE' });
    expect(await bad({ ...spec('val'), branding: { logo: { data_base64: PNG_B64, content_type: 'application/pdf' } } })).toMatchObject({ code: 'LOGO_INVALID_CONTENT_TYPE' });
    expect(await bad({ ...spec('val'), branding: { logo: 'http://insecure.example.com/l.png' } })).toMatchObject({ code: 'INVALID_LOGO' });
  });

  it('rejects public mail domains, unknown flags, bad colours and bad JSON in the canonical envelope', async () => {
    expect(await bad({ ...spec('val'), policy: { allowed_domains: ['gmail.com'] }, admins: ['a@gmail.com'] })).toMatchObject({ code: 'PUBLIC_EMAIL_DOMAIN' });
    expect(await bad({ ...spec('val'), policy: { features: { 'nope.flag': true } } })).toMatchObject({ code: 'INVALID_FEATURE' });
    expect(await bad({ ...spec('val'), branding: { accent_color: 'blue' } })).toMatchObject({ code: 'INVALID_COLOR' });
    expect(await bad('{')).toMatchObject({ success: false, code: 'INVALID_JSON' });
    expect(await count('SELECT COUNT(*) AS n FROM workspaces WHERE slug = ?', 'val')).toBe(0);
  });
});
