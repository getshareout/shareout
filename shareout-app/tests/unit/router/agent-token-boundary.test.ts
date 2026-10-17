// Workspace Agent and external `sot_` tokens only reach the routes that enforce their
// workspace boundary and scopes (artifacts, publish, data, support). Everywhere else
// they count as no credential, so they cannot act as the person behind them.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleFetch } from '../../../src/router/handle-fetch';
import { hashToken } from '../../../src/api-auth';

const WS = 'wsp_tb_a';
const PERSON = 'usr_tb_person';
const AGENT = 'usr_tb_agent';
const GUEST = 'usr_tb_guest';
const TOK = {
  person: 'so_' + '1'.repeat(64),
  agent: 'sot_' + '2'.repeat(64),
  external: 'sot_' + '3'.repeat(64),
};

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name, is_service) VALUES (?, 'person@example.com', 'p', 0), (?, NULL, 'agent', 1), (?, 'guest@example.org', 'g', 0)")
      .bind(PERSON, AGENT, GUEST),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'A', 'tb-a', ?)").bind(WS, PERSON),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_tb_1', ?, ?, 'owner', 'internal'), ('wm_tb_2', ?, ?, 'member', 'internal'), ('wm_tb_3', ?, ?, 'member', 'external')`)
      .bind(WS, PERSON, WS, AGENT, WS, GUEST),
  ]);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash) VALUES ('tok_tb_p', 'user', ?, ?, ?)")
      .bind(PERSON, PERSON, await hashToken(TOK.person)),
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, scopes) VALUES ('sot_tb_a', 'workspace', ?, ?, ?, 'artifacts:read,data:read')")
      .bind(WS, AGENT, await hashToken(TOK.agent)),
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, scopes, subject_external_user_id) VALUES ('sot_tb_x', 'workspace', ?, ?, ?, 'data:read', ?)")
      .bind(WS, GUEST, await hashToken(TOK.external), GUEST),
  ]);
});

const call = (token: string, method: string, path: string, body?: unknown) =>
  handleFetch(new Request(`https://shareout.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), e);

describe('sot_ tokens outside the routes that enforce their boundary', () => {
  for (const kind of ['agent', 'external'] as const) {
    it(`${kind} token cannot mint a personal token`, async () => {
      const res = await call(TOK[kind], 'POST', '/v1/me/tokens', { name: 'x' });
      expect(res.status).toBeGreaterThanOrEqual(401);
      expect(res.status).toBeLessThanOrEqual(403);
      const minted = await e.DB.prepare("SELECT COUNT(*) AS n FROM tokens WHERE principal_type = 'user' AND user_id IN (?, ?)").bind(AGENT, GUEST).first<{ n: number }>();
      expect(minted?.n).toBe(0);
    });

    it(`${kind} token cannot list workspaces or read members`, async () => {
      for (const path of ['/v1/workspaces', `/v1/workspaces/${WS}/members`, `/v1/workspaces/${WS}/people`]) {
        const res = await call(TOK[kind], 'GET', path);
        expect(res.status, path).toBe(403);
        expect(JSON.stringify(await res.json())).toMatch(/INSUFFICIENT_SCOPE/);
      }
    });
  }

  it('agent token still reads artifacts with artifacts:read', async () => {
    expect((await call(TOK.agent, 'GET', '/v1/artifacts')).status).toBe(200);
  });

  it('agent token can still list its support tickets', async () => {
    expect((await call(TOK.agent, 'GET', '/v1/support/tickets')).status).toBe(200);
  });

  it('a personal token is unaffected', async () => {
    expect((await call(TOK.person, 'GET', '/v1/workspaces')).status).toBe(200);
    expect((await call(TOK.person, 'GET', `/v1/workspaces/${WS}/members`)).status).toBe(200);
  });
});
