import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { createFetchContext } from '../../../src/router/context';
import { routeAuth } from '../../../src/router/auth-router';
import { createSessionToken } from '../../../src/token';

interface Row { id: string; device_code: string; user_code: string; status: string; user_id: string | null; token: string | null; expected_email: string | null; warn: string | null; expires_at: string }

function makeEnv() {
  const rows: Row[] = [];
  const tokens: unknown[][] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (sql.includes('INSERT INTO device_auth')) {
            const [id, device_code, user_code, expected_email, expires_at] = args as [string, string, string, string | null, string];
            rows.push({ id, device_code, user_code, status: 'pending', user_id: null, token: null, expected_email, warn: null, expires_at });
          } else if (sql.includes('INSERT INTO tokens')) tokens.push(args);
          else if (sql.includes("UPDATE device_auth SET status = 'approved'")) {
            const [user_id, token, warn, id] = args as [string, string, string | null, string];
            const r = rows.find(x => x.id === id)!;
            Object.assign(r, { status: 'approved', user_id, token, warn });
          } else if (sql.includes('DELETE FROM device_auth WHERE id')) {
            const i = rows.findIndex(x => x.id === args[0]);
            if (i >= 0) rows.splice(i, 1);
          }
          return { success: true, meta: { changes: 1 } };
        },
        first: async () => {
          if (sql.includes('FROM device_auth WHERE device_code')) return rows.find(x => x.device_code === args[0]) ?? null;
          if (sql.includes('FROM device_auth WHERE user_code')) return rows.find(x => x.user_code === args[0]) ?? null;
          if (sql.includes('FROM users')) return { disabled: 0 };
          return null;
        },
      }),
    }),
  };
  const env = { DB: db, SESSION_SECRET: 'test-secret-test-secret-test-secret', SHAREOUT_BASE_URL: 'https://shareout.site' } as unknown as Env;
  return { env, rows, tokens };
}

const call = (env: Env, path: string, init: RequestInit = {}) =>
  routeAuth(createFetchContext(new Request(`https://shareout.site${path}`, init), env));

import { handleDevicePage } from '../../../src/auth/device-auth';

describe('f09 device approval via GET', () => {
  it('blocks: GET /auth/device?code= with the victim cookie only shows a confirmation, the attacker poll stays pending', async () => {
    const { env, tokens } = makeEnv();
    const start = await (await call(env, '/v1/auth/device/start', { method: 'POST', body: '{}' }))!.json() as any;
    const session = await createSessionToken('usr_victim', 'victim@victim.test', env);
    const cookie = `shareout_session=${session}`;

    const res = (await call(env, `/auth/device?code=${encodeURIComponent(start.user_code)}`, { headers: { Cookie: cookie } }))!;
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('victim@victim.test');
    expect(html).toContain('method="POST"');

    const poll = await (await call(env, '/v1/auth/device/token', { method: 'POST', body: JSON.stringify({ device_code: start.device_code }) }))!.json() as any;
    expect(poll.status).toBe('pending');
    expect(poll.token).toBeUndefined();
    expect(tokens).toHaveLength(0);

    const post = (origin: string | null, site?: string) => handleDevicePage(new Request('https://shareout.site/auth/device', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', ...(origin ? { Origin: origin } : {}), ...(site ? { 'Sec-Fetch-Site': site } : {}) },
      body: new URLSearchParams({ code: start.user_code }),
    }), env);

    expect((await post('https://evil.example', 'cross-site')).status).toBe(400);
    expect((await post('https://evil.example')).status).toBe(400);
    expect(tokens).toHaveLength(0);

    expect((await post('https://shareout.site', 'same-origin')).status).toBe(200);
    const approved = await (await call(env, '/v1/auth/device/token', { method: 'POST', body: JSON.stringify({ device_code: start.device_code }) }))!.json() as any;
    expect(approved.status).toBe('approved');
    expect(approved.user_id).toBe('usr_victim');
    expect(approved.token).toMatch(/^so_/);
  });
});
