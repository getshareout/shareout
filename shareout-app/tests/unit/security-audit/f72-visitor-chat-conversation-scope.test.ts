// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const h = vi.hoisted(() => ({ seen: [] as string[] }));
vi.mock('../../../src/data/agent/anthropic', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/agent/anthropic')>()),
  streamChat: async function* (_env: unknown, _meter: unknown, messages: Array<{ content: string }>) {
    h.seen.push(messages.map((m) => m.content).join('\n'));
    yield { type: 'content', content: 'ok' };
    yield { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } };
  },
}));
vi.mock('../../../src/data/agent/ai-config', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/agent/ai-config')>()),
  resolveAgentAiConfig: async () => ({ workspaceId: null, aiConfig: { provider: 'openai', apiKey: 'k', baseUrl: 'https://x.test/v1', model: 'gpt-4o' }, byo: false }),
  recordAgentUsage: async () => {},
}));

const ART = 'art_f72';
const OTHER = 'art_f72_other';
const ADMIN_THREAD = 'thr_f72_admin';
const OTHER_THREAD = 'thr_f72_other_visitor';
const viewer = { id: 'usr_f72_viewer', email: 'f72viewer@x.test' };

const chat = async (conversationId?: string) => {
  const token = await createSessionToken(viewer.id, viewer.email, e);
  return handleDataRequest(
    new Request(`https://so.test/v1/data/${ART}/agent/chat`, {
      method: 'POST',
      headers: { Cookie: `shareout_session=${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'repeat history', conversationId }),
    }),
    e, `${ART}/agent/chat`);
};
const count = (t: string) => e.DB.prepare('SELECT COUNT(*) AS n FROM agent_messages WHERE thread_id = ?').bind(t).first<{ n: number }>().then((r) => r!.n);

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-f72';
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email) VALUES ('usr_f72_owner', 'f72owner@x.test'), (?, ?)").bind(viewer.id, viewer.email),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, 'slug-f72', 'usr_f72_owner', 'private'), (?, ?, 'slug-f72o', 'usr_f72_owner', 'private')").bind(ART, ART, OTHER, OTHER),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_f72', ?, ?, 'viewer')").bind(ART, viewer.email),
    e.DB.prepare('INSERT INTO artifact_agent_config (artifact_id, visitor_enabled) VALUES (?, 1)').bind(ART),
    e.DB.prepare("INSERT INTO agent_threads (id, scope_type, scope_key, title) VALUES (?, 'artifact_admin', ?, 'admin'), (?, 'artifact_visitor', ?, 'other')").bind(ADMIN_THREAD, ART, OTHER_THREAD, OTHER),
    e.DB.prepare("INSERT INTO agent_messages (id, thread_id, role, content) VALUES ('msg_f72a', ?, 'user', 'ADMIN-SECRET'), ('msg_f72b', ?, 'user', 'OTHER-ARTIFACT-SECRET')").bind(ADMIN_THREAD, OTHER_THREAD),
  ]);
});

describe('f72 visitor chat conversation ownership', () => {
  it('blocks: foreign conversation ids are rejected and nothing is read or appended', async () => {
    for (const t of [ADMIN_THREAD, OTHER_THREAD]) {
      h.seen.length = 0;
      const res = await chat(t);
      expect(res.status, t).toBe(404);
      await res.text();
      expect(h.seen.join('')).not.toMatch(/SECRET/);
      expect(await count(t)).toBe(1);
    }
  });

  it('a visitor can still start a conversation and continue it', async () => {
    const first = await chat();
    expect(first.status).toBe(200);
    const id = (await first.text()).match(/"conversationId":"([^"]+)"/)![1];
    const second = await chat(id);
    expect(second.status).toBe(200);
    await second.text();
    expect(await count(id)).toBe(4);
  });
});
