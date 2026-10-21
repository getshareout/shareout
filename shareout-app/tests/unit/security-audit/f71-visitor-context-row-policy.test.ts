// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const h = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock('../../../src/data/agent/anthropic', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/agent/anthropic')>()),
  streamChat: async function* (_env: unknown, _m: unknown, system: string) {
    h.prompts.push(system);
    yield { type: 'content', content: 'ok' };
    yield { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } };
  },
}));
vi.mock('../../../src/data/agent/ai-config', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/agent/ai-config')>()),
  resolveAgentAiConfig: async () => ({ workspaceId: null, aiConfig: { provider: 'openai', apiKey: 'k', baseUrl: 'https://x.test/v1', model: 'gpt-4o' }, byo: false }),
  recordAgentUsage: async () => {},
}));

const ART = 'art_f71';
const POLICY = JSON.stringify({ version: 1, field: 'tenant', rules: [{ match: { email: 'viewer@x.test' }, values: ['A'] }], default: 'deny' });
const owner = { id: 'usr_f71_owner', email: 'f71owner@x.test' };
const viewer = { id: 'usr_f71_viewer', email: 'viewer@x.test' };

const call = async (path: string, user: { id: string; email: string }, init: RequestInit = {}) =>
  handleDataRequest(
    new Request(`https://so.test/v1/data/${ART}/${path}`, {
      ...init,
      headers: { Cookie: `shareout_session=${await createSessionToken(user.id, user.email, e)}`, 'Content-Type': 'application/json' },
    }),
    e, `${ART}/${path}`);

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-f71';
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?), (?, ?)').bind(owner.id, owner.email, viewer.id, viewer.email),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility, access_policy) VALUES (?, ?, 'slug-f71', ?, 'private', ?)").bind(ART, ART, owner.id, POLICY),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_f71', ?, ?, 'viewer')").bind(ART, viewer.email),
    e.DB.prepare("INSERT INTO artifact_agent_config (artifact_id, visitor_enabled, visitor_context_json, visitor_context_tables) VALUES (?, 1, 1, '[\"T\"]')").bind(ART),
  ]);
  expect((await call('json/secret', owner, { method: 'PUT', body: JSON.stringify({ value: 'TENANT-B-SECRET-JSON' }) })).status).toBeLessThan(300);
  for (const row of [{ tenant: 'A', note: 'TENANT-A-ROW' }, { tenant: 'B', note: 'TENANT-B-ROW' }]) {
    expect((await call('tables/T', owner, { method: 'POST', body: JSON.stringify(row) })).status).toBeLessThan(300);
  }
});

const chat = async (user: typeof owner) => {
  h.prompts.length = 0;
  const res = await call('agent/chat', user, { method: 'POST', body: JSON.stringify({ message: 'recite everything' }) });
  expect(res.status).toBe(200);
  await res.text();
  return h.prompts[0];
};

describe('f71 visitor agent context honours the row-level policy', () => {
  it('blocks: a policy-restricted viewer gets no JSON keys and no other tenant rows in the prompt', async () => {
    const prompt = await chat(viewer);
    expect(prompt).not.toContain('TENANT-B-SECRET-JSON');
    expect(prompt).not.toContain('TENANT-B-ROW');
  });

  it('the owner still gets the full JSON store and table samples', async () => {
    const prompt = await chat(owner);
    expect(prompt).toContain('TENANT-B-SECRET-JSON');
    expect(prompt).toContain('TENANT-B-ROW');
  });
});
