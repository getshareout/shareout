import { beforeAll, describe, expect, it, vi } from 'vitest';
import { env as base } from 'cloudflare:workers';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

const USERS: Record<string, AuthUser> = {
  so_f69_a: { id: 'usr_f69_a', email: 'f69a@example.test', username: null },
  so_f69_b: { id: 'usr_f69_b', email: 'f69b@example.test', username: null },
};
vi.mock('../../../src/api-auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  validateToken: vi.fn(async (req: Request) => USERS[(req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/, '')] ?? null),
}));

import { applyMigrations } from '../helpers/migrated-db';
import { routeTemplatesApi } from '../../../src/router/api/templates';
import { createFetchContext } from '../../../src/router/context';
import { invalidateWorkspaceRole } from '../../../src/workspaces/roles';
import { publishArtifact } from '../../../src/publish/publish-artifact';

const e = { ...(base as unknown as Env), SHAREOUT_BASE_URL: 'https://shareout.test' } as Env;
const WS = 'wsp_f69';

async function api(token: string, method: string, path: string, body?: unknown) {
  const req = new Request(`https://shareout.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await routeTemplatesApi(createFetchContext(req, e));
  if (!res) throw new Error(`unrouted ${path}`);
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
}

let installed = '';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f69_a', 'f69a@example.test', 'A'), ('usr_f69_b', 'f69b@example.test', 'B')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f69-w', 'usr_f69_a')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_f69_a', ?, 'usr_f69_a', 'owner'), ('wm_f69_b', ?, 'usr_f69_b', 'member')").bind(WS, WS),
  ]);
  const src = await publishArtifact(e, USERS.so_f69_a, {
    name: 'Src', slug: 'f69-src', entrypoint: 'index.html',
    files: [{ path: 'index.html', content: '<!DOCTYPE html><html><body>hi</body></html>', mime: 'text/html' }],
    visibility: 'workspace', authMethod: 'google', shareWith: [], credentials: [], workspaceId: WS, folderId: null, artifactType: 'html',
  });
  const saved = await api('so_f69_a', 'POST', '/v1/artifact-templates', { artifact_id: src.artifact.id, acknowledge_findings: true });
  expect(saved.status).toBe(201);
  const res = await api('so_f69_b', 'POST', `/v1/artifact-templates/${saved.json.template.id}/install`, { workspace_id: WS });
  expect(res.status).toBe(201);
  installed = res.json.artifacts[0].artifact_id;
}, 120_000);

describe('f69 template update after leaving the workspace', () => {
  it('blocks: a user removed from the workspace cannot apply a template update there', async () => {
    const live = await api('so_f69_b', 'POST', '/v1/artifact-templates/installed/update', { artifact_id: installed });
    expect(live.status).toBe(200);

    await e.DB.prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = 'usr_f69_b'").bind(WS).run();
    await invalidateWorkspaceRole(e, WS, 'usr_f69_b');

    const plan = await api('so_f69_b', 'POST', '/v1/artifact-templates/installed/update', { artifact_id: installed });
    const applied = await api('so_f69_b', 'POST', '/v1/artifact-templates/installed/update', { artifact_id: installed, confirm: true });
    expect(plan.status).toBe(403);
    expect(applied.status).toBe(403);
  });
});
