// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const BASE = 'https://shareout.example.com';
const MCP_TOKEN = 'so_f45_mcp_access_token';
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const call = (path: string, method: string, token: string, body?: unknown) =>
  handleFetch(new Request(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }), e, ctx);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f45', 'f45@example.test', 'u')"),
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name, expires_at) VALUES ('tok_f45_mcp', 'user', 'usr_f45', 'usr_f45', ?, 'mcp:Dummy App', ?)")
      .bind(await hashToken(MCP_TOKEN), new Date(Date.now() + 3600_000).toISOString()),
  ]);
});

describe('f45 MCP OAuth access token', () => {
  it('blocks: an mcp: access token cannot mint API tokens', async () => {
    const before = await e.DB.prepare('SELECT COUNT(*) c FROM tokens').first<{ c: number }>();
    const mint = await call('/v1/me/tokens', 'POST', MCP_TOKEN);
    expect(mint.status).toBe(403);
    const after = await e.DB.prepare('SELECT COUNT(*) c FROM tokens').first<{ c: number }>();
    expect(after?.c).toBe(before?.c);
  });

  it('still lets a personal token mint API tokens', async () => {
    const PERSONAL = 'so_f45_personal_token';
    await e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f45_personal', 'user', 'usr_f45', 'usr_f45', ?, 'cli')")
      .bind(await hashToken(PERSONAL)).run();
    expect((await call('/v1/me/tokens', 'POST', PERSONAL)).status).toBe(200);
  });
});
