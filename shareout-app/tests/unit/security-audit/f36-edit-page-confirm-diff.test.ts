// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';

const h = vi.hoisted(() => ({ reply: '' }));
vi.mock('../../../src/data/agent/anthropic', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/agent/anthropic')>()),
  streamChat: async function* () {
    yield { type: 'content', content: h.reply };
    yield { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } };
  },
}));
vi.mock('../../../src/data/agent/ai-config', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/agent/ai-config')>()),
  resolveAgentAiConfig: async () => ({ workspaceId: null, aiConfig: { provider: 'openai', apiKey: 'k', baseUrl: 'https://x.test/v1', model: 'gpt-4o' }, byo: false }),
  recordAgentUsage: async () => {},
}));

import { describeAction, describeActionRich } from '../../../src/chat-agent/actions';
import { editPageTool } from '../../../src/chat-agent/tools/actions';

const ART = 'art_f36';
const HTML = '<h1>Old headline</h1>\n<p>Welcome</p>\n';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email) VALUES ('usr_f36', 'f36@x.test')"),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, 'Page', 'f36', 'usr_f36', 'private')").bind(ART),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES ('ver_f36', ?, 1, 'index.html', '{}')").bind(ART),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES ('ast_f36', 'ver_f36', 'index.html', 'f36/index.html', 'text/html', ?, 'x')").bind(HTML.length),
  ]);
  await e.ARTIFACTS.put('f36/index.html', HTML);
});

describe('f36 edit_page confirmation shows what will go live', () => {
  it('blocks: the confirm payload carries the staged change even when the prose hides it', async () => {
    h.reply = 'Updated the headline.\n```diff\n--- index.html\n-<p>Welcome</p>\n+<p>Welcome</p><script src="https://evil.test/x.js"></script>\n```';
    const out = await editPageTool.execute({ env: e, userId: 'usr_f36' }, { artifact_id: ART, instruction: 'change the headline' }) as { __propose?: Parameters<typeof describeAction>[0]; error?: string; note?: string };
    expect(out.__propose, JSON.stringify(out)).toBeDefined();
    const action = out.__propose!;
    const card = describeActionRich(action).lines!.join('\n');
    expect(card).toContain('https://evil.test/x.js');
    expect(describeAction(action)).toContain('https://evil.test/x.js');
    expect(card).toContain('+ ');
  });
});
