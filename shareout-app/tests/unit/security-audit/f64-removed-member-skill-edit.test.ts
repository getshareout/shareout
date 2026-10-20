// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';
import { canReviewSkillChanges, loadSkillGovernance } from '../../../src/skills/policy';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const BASE = 'https://shareout.example.com';
const A_TOKEN = 'so_f64_owner_token';
const B_TOKEN = 'so_f64_author_token';
const C_TOKEN = 'so_f64_member_token';
const D_TOKEN = 'so_f64_author2_token';
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
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f64_a', 'f64a@example.test', 'a'), ('usr_f64_b', 'f64b@example.test', 'b'), ('usr_f64_c', 'f64c@example.test', 'c'), ('usr_f64_d', 'f64d@example.test', 'd')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f64-w', 'usr_f64_a')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f64_a', ?, 'usr_f64_a', 'owner', 'internal'), ('wm_f64_b', ?, 'usr_f64_b', 'member', 'internal'), ('wm_f64_c', ?, 'usr_f64_c', 'member', 'internal'), ('wm_f64_d', ?, 'usr_f64_d', 'member', 'internal')").bind(WS, WS, WS, WS),
  ]);
  await e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f64_a', 'user', 'usr_f64_a', 'usr_f64_a', ?, 'a'), ('tok_f64_b', 'user', 'usr_f64_b', 'usr_f64_b', ?, 'b'), ('tok_f64_c', 'user', 'usr_f64_c', 'usr_f64_c', ?, 'c'), ('tok_f64_d', 'user', 'usr_f64_d', 'usr_f64_d', ?, 'd')")
    .bind(await hashToken(A_TOKEN), await hashToken(B_TOKEN), await hashToken(C_TOKEN), await hashToken(D_TOKEN)).run();
});

describe('f64 removed member who authored a skill', () => {
  it('blocks: removed member cannot publish a new skill version', async () => {
    const create = await call(`/v1/workspaces/${WS}/skills`, {
      method: 'POST', token: B_TOKEN,
      body: JSON.stringify({ name: 'Deploy checklist', markdown: '---\nsummary: s\n---\n\n# Deploy\n\nOriginal steps.\n' }),
    });
    const created = await create.json() as { artifact_id: string; version_no: number };
    expect(create.status).toBe(201);
    const id = created.artifact_id;

    const ok = await call(`/v1/skills/${id}/markdown`, {
      method: 'PUT', token: B_TOKEN,
      body: JSON.stringify({ markdown: '---\nsummary: s\n---\n\n# Deploy\n\nUpdated by member.\n' }),
    });
    expect(ok.status).toBe(200);

    const del = await call(`/v1/workspaces/${WS}/members/usr_f64_b`, { method: 'DELETE', token: A_TOKEN });
    expect(del.status).toBe(200);

    const put = await call(`/v1/skills/${id}/markdown`, {
      method: 'PUT', token: B_TOKEN,
      body: JSON.stringify({ markdown: '---\nsummary: s\n---\n\n# Deploy\n\nATTACKER-CHOSEN steps.\n' }),
    });
    expect(put.status).toBe(403);

    const raw = await call(`/v1/skills/${id}/raw`, { method: 'GET', token: C_TOKEN });
    const rawText = await raw.text();
    expect(raw.status).toBe(200);
    expect(rawText).toContain('Updated by member');
    expect(rawText).not.toContain('ATTACKER-CHOSEN');
  });

  it('blocks: removed member cannot set policy or review changes on a skill they own', async () => {
    const create = await call(`/v1/workspaces/${WS}/skills`, {
      method: 'POST', token: D_TOKEN,
      body: JSON.stringify({ name: 'Runbook', markdown: '---\nsummary: s\n---\n\n# Runbook\n' }),
    });
    expect(create.status).toBe(201);
    const { artifact_id: id } = await create.json() as { artifact_id: string };
    const setPolicy = () => call(`/v1/skills/${id}/policy`, { method: 'PUT', token: D_TOKEN, body: JSON.stringify({ edit_policy: 'approval' }) });
    const gov = (await loadSkillGovernance(e, id))!;

    expect((await setPolicy()).status).toBe(200);
    expect(await canReviewSkillChanges(e, 'usr_f64_d', gov)).toBe(true);

    const del = await call(`/v1/workspaces/${WS}/members/usr_f64_d`, { method: 'DELETE', token: A_TOKEN });
    expect(del.status).toBe(200);

    expect((await setPolicy()).status).toBe(403);
    expect(await canReviewSkillChanges(e, 'usr_f64_d', gov)).toBe(false);
  });
});
