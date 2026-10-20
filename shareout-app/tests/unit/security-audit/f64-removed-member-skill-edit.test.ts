// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const BASE = 'https://shareout.example.com';
const A_TOKEN = 'so_f64_owner_token';
const B_TOKEN = 'so_f64_author_token';
const C_TOKEN = 'so_f64_member_token';
const WS = 'wsp_f64';

const call = (path: string, init: RequestInit & { token: string }) => {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (rest.body) headers.set('Content-Type', 'application/json');
  return handleFetch(new Request(`${BASE}${path}`, { ...rest, headers }), e, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
};

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f64_a', 'f64a@example.test', 'a'), ('usr_f64_b', 'f64b@example.test', 'b'), ('usr_f64_c', 'f64c@example.test', 'c')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f64-w', 'usr_f64_a')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f64_a', ?, 'usr_f64_a', 'owner', 'internal'), ('wm_f64_b', ?, 'usr_f64_b', 'member', 'internal'), ('wm_f64_c', ?, 'usr_f64_c', 'member', 'internal')").bind(WS, WS, WS),
  ]);
  await e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f64_a', 'user', 'usr_f64_a', 'usr_f64_a', ?, 'a'), ('tok_f64_b', 'user', 'usr_f64_b', 'usr_f64_b', ?, 'b'), ('tok_f64_c', 'user', 'usr_f64_c', 'usr_f64_c', ?, 'c')")
    .bind(await hashToken(A_TOKEN), await hashToken(B_TOKEN), await hashToken(C_TOKEN)).run();
});

describe('f64 removed member who authored a skill', () => {
  it('CONFIRMS: removed member can still publish a new skill version that current members receive', async () => {
    const create = await call(`/v1/workspaces/${WS}/skills`, {
      method: 'POST', token: B_TOKEN,
      body: JSON.stringify({ name: 'Deploy checklist', markdown: '---\nsummary: s\n---\n\n# Deploy\n\nOriginal steps.\n' }),
    });
    const created = await create.json() as { artifact_id: string; version_no: number };
    expect(create.status).toBe(201);
    const id = created.artifact_id;

    const del = await call(`/v1/workspaces/${WS}/members/usr_f64_b`, { method: 'DELETE', token: A_TOKEN });
    expect(del.status).toBe(200);
    const m = await e.DB.prepare("SELECT COUNT(*) AS n FROM workspace_members WHERE user_id = 'usr_f64_b'").first<{ n: number }>();
    expect(m!.n).toBe(0);

    const put = await call(`/v1/skills/${id}/markdown`, {
      method: 'PUT', token: B_TOKEN,
      body: JSON.stringify({ markdown: '---\nsummary: s\n---\n\n# Deploy\n\nATTACKER-CHOSEN steps.\n' }),
    });
    const putBody = await put.text();
    console.log('f64 after-removal PUT markdown:', put.status, putBody);
    expect(put.status).toBe(200);
    expect((JSON.parse(putBody) as { version_no: number }).version_no).toBe(created.version_no + 1);

    const raw = await call(`/v1/skills/${id}/raw`, { method: 'GET', token: C_TOKEN });
    const rawText = await raw.text();
    console.log('f64 current-member raw read:', raw.status, JSON.stringify(rawText));
    expect(raw.status).toBe(200);
    expect(rawText).toContain('ATTACKER-CHOSEN');
  });
});
