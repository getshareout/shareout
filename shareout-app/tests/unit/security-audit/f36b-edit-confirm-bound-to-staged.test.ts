// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';

const h = vi.hoisted(() => ({ reply: '', published: 0 }));
vi.mock('../../../src/data/agent/anthropic', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/agent/anthropic')>()),
  streamChat: async function* () {
    yield { type: 'content', content: h.reply };
    yield { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } };
  },
}));
vi.mock('../../../src/data/agent/admin-chat', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/agent/admin-chat')>()),
  publishConversation: async () => { h.published++; return { ok: true, url: 'https://x.test/p' }; },
}));
vi.mock('../../../src/data/agent/ai-config', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/agent/ai-config')>()),
  resolveAgentAiConfig: async () => ({ workspaceId: null, aiConfig: { provider: 'openai', apiKey: 'k', baseUrl: 'https://x.test/v1', model: 'gpt-4o' }, byo: false }),
  recordAgentUsage: async () => {},
}));

import { executeAction, type PendingAction } from '../../../src/chat-agent/actions';
import { editPageTool } from '../../../src/chat-agent/tools/actions';

const ART = 'art_f36b';
const HTML = '<h1>Old headline</h1>\n<p>Welcome</p>\n';

async function stage(): Promise<PendingAction> {
  h.published = 0;
  h.reply = 'Updated.\n```diff\n--- index.html\n-<p>Welcome</p>\n+<p>Hello</p>\n```';
  const out = await editPageTool.execute({ env: e, userId: 'usr_f36b' }, { artifact_id: ART, instruction: 'tweak' }) as { __propose?: PendingAction };
  expect(out.__propose).toBeDefined();
  return out.__propose!;
}

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email) VALUES ('usr_f36b', 'f36b@x.test')"),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, 'Page', 'f36b', 'usr_f36b', 'private')").bind(ART),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES ('ver_f36b', ?, 1, 'index.html', '{}')").bind(ART),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES ('ast_f36b', 'ver_f36b', 'index.html', 'f36b/index.html', 'text/html', ?, 'x')").bind(HTML.length),
  ]);
  await e.ARTIFACTS.put('f36b/index.html', HTML);
});

describe('f36b edit_publish confirmation is bound to the staged content', () => {
  it('blocks: staged content changed after the confirm card was shown', async () => {
    const action = await stage();
    const conv = (action as { conversationId: string }).conversationId;
    await e.DB.prepare("UPDATE artifact_pending_edits SET new_content = '<script src=\"https://evil.test/x.js\"></script>' WHERE thread_id = ?").bind(conv).run();
    const msg = await executeAction(e, 'usr_f36b', action);
    expect(msg).toMatch(/changed/i);
    expect(h.published).toBe(0);
  });

  it('blocks: an action with no staged hash is refused', async () => {
    const action = await stage();
    const { stagedHash: _drop, ...rest } = action as PendingAction & { stagedHash?: string };
    const msg = await executeAction(e, 'usr_f36b', rest as PendingAction);
    expect(msg).toMatch(/changed|confirm/i);
    expect(h.published).toBe(0);
  });

  it('still publishes the unchanged staged edit', async () => {
    const action = await stage();
    const msg = await executeAction(e, 'usr_f36b', action);
    expect(msg).toMatch(/Published/);
    expect(h.published).toBe(1);
  });
});
