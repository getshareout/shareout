import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleDeviceStart,
  handleDevicePoll,
  approveDeviceCode,
  normalizeUserCode,
} from '../../../src/auth/device-auth';
import type { Env } from '../../../src/types';

interface DeviceRow {
  id: string;
  device_code: string;
  user_code: string;
  status: string;
  user_id: string | null;
  token: string | null;
  expected_email: string | null;
  warn: string | null;
  expires_at: string;
}

// Stateful fake D1 covering exactly the statements device-auth.ts issues.
function makeEnv(): { env: Env; rows: DeviceRow[]; tokens: any[] } {
  const rows: DeviceRow[] = [];
  const tokens: any[] = [];

  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (sql.includes('INSERT INTO device_auth')) {
            const [id, device_code, user_code, expected_email, expires_at] =
              args as [string, string, string, string | null, number];
            rows.push({ id, device_code, user_code, status: 'pending', user_id: null, token: null, expected_email, warn: null, expires_at });
          } else if (sql.includes('INSERT INTO tokens')) {
            tokens.push(args);
          } else if (sql.includes("UPDATE device_auth SET status = 'approved'")) {
            const [user_id, token, warn, id] = args as [string, string, string | null, string];
            const r = rows.find(x => x.id === id);
            if (r) { r.status = 'approved'; r.user_id = user_id; r.token = token; r.warn = warn; }
          } else if (sql.includes('DELETE FROM device_auth WHERE id')) {
            const idx = rows.findIndex(x => x.id === args[0]);
            if (idx >= 0) rows.splice(idx, 1);
          }
          return { success: true, meta: { changes: 1 } };
        },
        first: async () => {
          if (sql.includes('FROM device_auth WHERE device_code')) {
            return rows.find(x => x.device_code === args[0]) ?? null;
          }
          if (sql.includes('FROM device_auth WHERE user_code')) {
            return rows.find(x => x.user_code === args[0]) ?? null;
          }
          return null;
        },
      }),
    }),
  };

  return {
    env: { DB: db, SHAREOUT_BASE_URL: 'https://shareout.example.com' } as unknown as Env,
    rows,
    tokens,
  };
}

function req(body?: unknown): Request {
  return new Request('https://shareout.example.com/x', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(() => vi.restoreAllMocks());

describe('normalizeUserCode', () => {
  it('uppercases, strips punctuation, reinserts the dash', () => {
    expect(normalizeUserCode('bcdf-ghjk')).toBe('BCDF-GHJK');
    expect(normalizeUserCode('bcdfghjk')).toBe('BCDF-GHJK');
    expect(normalizeUserCode(' bc df gh jk ')).toBe('BCDF-GHJK');
  });
});

describe('handleDeviceStart', () => {
  it('mints a pending row and returns device+user codes and verification uris', async () => {
    const { env, rows } = makeEnv();
    const res = await handleDeviceStart(req(), env);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.device_code).toMatch(/^[0-9a-f]{64}$/);
    expect(body.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.verification_uri).toBe('https://shareout.example.com/auth/device');
    expect(body.verification_uri_complete).toContain(`code=${encodeURIComponent(body.user_code)}`);
    expect(body.interval).toBeGreaterThan(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].expected_email).toBeNull();
  });

  it('stores a valid expected_email and ignores a malformed one', async () => {
    const { env, rows } = makeEnv();
    await handleDeviceStart(req({ expected_email: 'Alice@Acme.com' }), env);
    expect(rows[0].expected_email).toBe('alice@acme.com'); // normalized

    await handleDeviceStart(req({ expected_email: 'not-an-email' }), env);
    expect(rows[1].expected_email).toBeNull();
  });
});

describe('handleDevicePoll', () => {
  it('returns pending before approval', async () => {
    const { env } = makeEnv();
    const start = await (await handleDeviceStart(req(), env)).json() as any;
    const res = await handleDevicePoll(req({ device_code: start.device_code }), env);
    expect((await res.json() as any).status).toBe('pending');
  });

  it('returns invalid_grant for an unknown device_code', async () => {
    const { env } = makeEnv();
    const res = await handleDevicePoll(req({ device_code: 'nope' }), env);
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe('invalid_grant');
  });

  it('hands the token over once after approval, then consumes the row', async () => {
    const { env, rows, tokens } = makeEnv();
    const start = await (await handleDeviceStart(req(), env)).json() as any;

    const approval = await approveDeviceCode(env, start.user_code, 'usr_42', 'bob@gmail.com');
    expect(approval.ok).toBe(true);
    expect(tokens).toHaveLength(1);
    if (approval.ok) expect(approval.warn).toBeNull();

    const res = await handleDevicePoll(req({ device_code: start.device_code }), env);
    const body = await res.json() as any;
    expect(body.status).toBe('approved');
    expect(body.token).toMatch(/^so_[0-9a-f]{64}$/);
    expect(body.user_id).toBe('usr_42');
    expect(rows).toHaveLength(0); // consumed

    const res2 = await handleDevicePoll(req({ device_code: start.device_code }), env);
    expect((await res2.json() as any).error).toBe('invalid_grant');
  });

  it('no warn when there is no expected_email (solo new signup)', async () => {
    const { env } = makeEnv();
    const start = await (await handleDeviceStart(req(), env)).json() as any;
    const approval = await approveDeviceCode(env, start.user_code, 'usr_new', 'solo@gmail.com');
    expect(approval.ok).toBe(true);
    if (approval.ok) expect(approval.warn).toBeNull();
  });

  it('no warn when the signed-in email matches expected_email', async () => {
    const { env } = makeEnv();
    const start = await (await handleDeviceStart(req({ expected_email: 'alice@acme.com' }), env)).json() as any;
    const approval = await approveDeviceCode(env, start.user_code, 'usr_a', 'Alice@Acme.com');
    expect(approval.ok).toBe(true);
    if (approval.ok) expect(approval.warn).toBeNull();
  });

  it('warns when the signed-in email differs from expected_email', async () => {
    const { env } = makeEnv();
    const start = await (await handleDeviceStart(req({ expected_email: 'alice@acme.com' }), env)).json() as any;
    const approval = await approveDeviceCode(env, start.user_code, 'usr_wrong', 'alice.personal@gmail.com');
    expect(approval.ok).toBe(true);
    if (approval.ok) expect(approval.warn).toMatch(/expected alice@acme\.com/i);

    const body = await (await handleDevicePoll(req({ device_code: start.device_code }), env)).json() as any;
    expect(body.warn).toMatch(/expected alice@acme\.com/i);
  });

  it('rejects an expired code and cleans it up', async () => {
    const { env, rows } = makeEnv();
    const start = await (await handleDeviceStart(req(), env)).json() as any;
    rows[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await handleDevicePoll(req({ device_code: start.device_code }), env);
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe('expired_token');
    expect(rows).toHaveLength(0);
  });
});

describe('approveDeviceCode', () => {
  it('rejects an unknown user_code', async () => {
    const { env } = makeEnv();
    const result = await approveDeviceCode(env, 'ZZZZ-ZZZZ', 'usr_1', 'x@y.com');
    expect(result.ok).toBe(false);
  });

  it('rejects a second approval of the same code', async () => {
    const { env } = makeEnv();
    const start = await (await handleDeviceStart(req(), env)).json() as any;
    await approveDeviceCode(env, start.user_code, 'usr_1', 'x@y.com');
    const again = await approveDeviceCode(env, start.user_code, 'usr_1', 'x@y.com');
    expect(again.ok).toBe(false);
  });
});
