// Billing details: validation (CUIT check digit, Argentine postal codes, phone, required fields) and, on real
// D1, who may read and edit them — the workspace's owners/admins and the operator, never members,
// externals, outsiders or agent tokens.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import initSql from '../../migrations/0000_init.sql?raw';
import profilesSql from '../../migrations/0040_workspace_billing_profiles.sql?raw';
import { handleGetBillingProfile, handlePutBillingProfile } from '../../src/router/api/workspace-billing-profile';
import { formatCuit, normalizeCuit, parseBillingProfile } from '../../src/workspaces/billing-profile';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

const valid = {
  country: 'AR', legal_name: '  Acme   S.A. ', tax_id: '33-69345023-9', tax_condition: 'responsable_inscripto',
  address: 'Av. Corrientes 1234, piso 5', city: 'CABA', province: 'Buenos Aires', postal_code: 'c1043aak', phone: '+54 11 4321-5678',
  billing_email: 'Facturas@Acme.com.ar',
};

describe('normalizeCuit', () => {
  it('accepts a CUIT with or without dashes when the check digit matches', () => {
    expect(normalizeCuit('33-69345023-9')).toBe('33693450239');
    expect(normalizeCuit('20 12345678 6')).toBe('20123456786');
    expect(normalizeCuit('30.71234567.1')).toBe('30712345671');
    expect(formatCuit('33693450239')).toBe('33-69345023-9');
  });

  it('refuses a wrong check digit, the wrong length, letters, and a number that would need a 10', () => {
    for (const bad of ['33-69345023-8', '3369345023', '336934502391', '33-6934502X-9', '20-00000001-0', '20-00000001-9', '']) {
      expect(normalizeCuit(bad), bad).toBeNull();
    }
  });
});

describe('parseBillingProfile', () => {
  it('normalizes a complete Argentine profile', () => {
    const r = parseBillingProfile(valid);
    expect(r).toEqual({
      profile: {
        country: 'AR', legal_name: 'Acme S.A.', tax_id: '33693450239', tax_condition: 'responsable_inscripto',
        address: 'Av. Corrientes 1234, piso 5', city: 'CABA', province: 'Buenos Aires', postal_code: 'C1043AAK',
        phone: '+54 11 4321-5678', billing_email: 'facturas@acme.com.ar',
      },
    });
    expect(parseBillingProfile({ ...valid, postal_code: '1425', billing_email: '' })).toMatchObject({ profile: { postal_code: '1425', billing_email: null } });
  });

  it('reports every problem at once, by field', () => {
    expect(parseBillingProfile({ country: 'AR' })).toEqual({
      errors: {
        legal_name: 'required', tax_id: 'required', tax_condition: 'required', address: 'required', city: 'required',
        province: 'required', postal_code: 'required', phone: 'required',
      },
    });
    expect(parseBillingProfile({ ...valid, tax_id: '33-69345023-8', postal_code: '14250', phone: '123', billing_email: 'nope', tax_condition: 'iva' })).toEqual({
      errors: { tax_id: 'invalid', postal_code: 'invalid', phone: 'invalid', billing_email: 'invalid', tax_condition: 'invalid' },
    });
    expect(parseBillingProfile({ ...valid, legal_name: 'x'.repeat(201) })).toEqual({ errors: { legal_name: 'too_long' } });
    expect(parseBillingProfile({ ...valid, country: 'ARG' })).toMatchObject({ errors: { country: 'invalid' } });
  });

  it('outside Argentina: any tax id shape, no IVA condition, no province needed', () => {
    const r = parseBillingProfile({ ...valid, country: 'us', tax_id: '12-3456789', tax_condition: 'whatever', province: '', postal_code: '94103' });
    expect(r).toMatchObject({ profile: { country: 'US', tax_id: '12-3456789', tax_condition: null, province: null, postal_code: '94103' } });
  });
});

const e = { ...(env as unknown as Env), INSTANCE_ADMIN_EMAILS: 'op@example.com' } as Env;
const WS = 'wsp_bp_acme', OTHER = 'wsp_bp_other';
const as = (id: string, email: string): AuthUser => ({ id, email, username: null });
const OP = as('usr_bp_op', 'op@example.com');
const OWNER = as('usr_bp_owner', 'owner@acme.test');
const ADMIN = as('usr_bp_admin', 'admin@acme.test');
const MEMBER = as('usr_bp_member', 'member@acme.test');
const EXTERNAL = as('usr_bp_ext', 'ext@partner.test');
const STRANGER = as('usr_bp_stranger', 'boss@other.test');
const AGENT = { ...ADMIN, service: { scopes: ['publish'] } } as unknown as AuthUser;
const put = (body: unknown) => new Request(`https://shareout.test/v1/workspaces/${WS}/billing-profile`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });

beforeAll(async () => {
  for (const sql of [initSql, profilesSql]) {
    const stmts = sql.replace(/--[^\n]*/g, '').split(/;\s*\n/).map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < stmts.length; i += 50) await e.DB.batch(stmts.slice(i, i + 50).map((x) => e.DB.prepare(x)));
  }
  for (const u of [OP, OWNER, ADMIN, MEMBER, EXTERNAL, STRANGER]) await e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(u.id, u.email).run();
  await e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Acme', 'acme-bp', ?), (?, 'Other', 'other-bp', ?)").bind(WS, OWNER.id, OTHER, STRANGER.id).run();
  const member = (id: string, ws: string, u: AuthUser, role: string, cls = 'internal') =>
    e.DB.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES (?, ?, ?, ?, ?)').bind(id, ws, u.id, role, cls).run();
  await member('wm_bp1', WS, OWNER, 'owner');
  await member('wm_bp2', WS, ADMIN, 'admin');
  await member('wm_bp3', WS, MEMBER, 'member');
  await member('wm_bp4', WS, EXTERNAL, 'admin', 'external');
  await member('wm_bp5', OTHER, STRANGER, 'owner');
});

describe('billing details API', () => {
  it('starts empty for an admin', async () => {
    const r = await read(await handleGetBillingProfile(e, ADMIN, WS));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ profile: null, can_edit: true });
    expect(r.body.tax_conditions).toContain('monotributo');
  });

  it('refuses a bad profile with each field, and saves nothing', async () => {
    const r = await read(await handlePutBillingProfile(put({ ...valid, tax_id: '33-69345023-8', phone: '' }), e, ADMIN, WS));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { tax_id: 'invalid', phone: 'required' } });
    expect((await read(await handleGetBillingProfile(e, ADMIN, WS))).body.profile).toBeNull();
  });

  it('an admin saves it; the owner and the operator read it back; the change is audited', async () => {
    const r = await read(await handlePutBillingProfile(put(valid), e, ADMIN, WS));
    expect(r.status).toBe(200);
    expect(r.body.profile).toMatchObject({ legal_name: 'Acme S.A.', tax_id: '33693450239', tax_id_display: '33-69345023-9', postal_code: 'C1043AAK', updated_by_email: ADMIN.email });
    for (const u of [OWNER, OP]) {
      expect((await read(await handleGetBillingProfile(e, u, WS))).body.profile.tax_id, u.email).toBe('33693450239');
    }
    const upd = await read(await handlePutBillingProfile(put({ ...valid, phone: '+54 351 555-1234' }), e, OWNER, WS));
    expect(upd.body.profile).toMatchObject({ phone: '+54 351 555-1234', updated_by_email: OWNER.email });
    const logs = await e.DB.prepare("SELECT detail FROM audit_log WHERE workspace_id = ? AND action = 'billing_profile.update' ORDER BY rowid").bind(WS).all<{ detail: string }>();
    expect(logs.results.map((l) => JSON.parse(l.detail).fields)).toEqual([
      ['country', 'legal_name', 'tax_id', 'tax_condition', 'address', 'city', 'province', 'postal_code', 'phone', 'billing_email'],
      ['phone'],
    ]);
  });

  it('members, externals, other workspaces and agent tokens can neither read nor edit it', async () => {
    for (const u of [MEMBER, EXTERNAL, STRANGER, AGENT]) {
      expect((await handleGetBillingProfile(e, u, WS)).status, u.email).toBe(403);
      expect((await handlePutBillingProfile(put(valid), e, u, WS)).status, u.email).toBe(403);
    }
  });

  it('the operator gets a 404 for a workspace that does not exist', async () => {
    expect((await handleGetBillingProfile(e, OP, 'wsp_nope')).status).toBe(404);
  });
});
