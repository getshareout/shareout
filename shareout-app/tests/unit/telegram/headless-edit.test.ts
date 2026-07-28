import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const resolveAgentAiConfig = vi.hoisted(() => vi.fn());
const recordAgentUsage = vi.hoisted(() => vi.fn());
const recordUsage = vi.hoisted(() => vi.fn());
const buildAdminContext = vi.hoisted(() => vi.fn());
const buildAdminSystemPrompt = vi.hoisted(() => vi.fn());
const streamChat = vi.hoisted(() => vi.fn());
const applyEditsToPending = vi.hoisted(() => vi.fn());
const publishConversation = vi.hoisted(() => vi.fn());

vi.mock('../../../src/data/agent/ai-config', () => ({ resolveAgentAiConfig, recordAgentUsage }));
vi.mock('../../../src/data/agent/usage', () => ({ recordUsage }));
vi.mock('../../../src/data/agent/context', () => ({ buildAdminContext, buildAdminSystemPrompt }));
vi.mock('../../../src/data/agent/anthropic', () => ({ streamChat }));
// Keep the real parseEditSuggestions; mock only the staging/publish writers.
vi.mock('../../../src/data/agent/admin-chat', async (orig) => {
  const actual = await orig<typeof import('../../../src/data/agent/admin-chat')>();
  return { ...actual, applyEditsToPending, publishConversation };
});
vi.mock('../../../src/data/minidb-client', () => ({ createMiniDb: () => ({}) }));
vi.mock('../../../src/crypto-utils', () => ({ generateId: (p: string) => `${p}_x` }));

import { proposeEdit, publishEdits } from '../../../src/data/agent/headless-edit';

// env.DB stub: prepare().bind().run()/first() no-ops (conversation/message inserts).
const env = {
  DB: { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => ({ id: 'a1', name: 'Page', workspace_id: null }) }) }) },
} as unknown as Env;

async function* gen(chunks: unknown[]) {
  for (const c of chunks) yield c;
}

beforeEach(() => {
  [resolveAgentAiConfig, recordAgentUsage, recordUsage, buildAdminContext, buildAdminSystemPrompt, streamChat, applyEditsToPending, publishConversation].forEach((m) => m.mockReset());
  buildAdminContext.mockResolvedValue({});
  buildAdminSystemPrompt.mockReturnValue('sys');
  recordUsage.mockResolvedValue(undefined);
  recordAgentUsage.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('proposeEdit', () => {
  it('errors when no AI provider is configured', async () => {
    resolveAgentAiConfig.mockResolvedValue({ aiConfig: null });
    const res = await proposeEdit(env, 'a1', 'change the headline');
    expect(res).toMatchObject({ ok: false });
  });

  it('stages edits parsed from the agent diff and reports the files', async () => {
    resolveAgentAiConfig.mockResolvedValue({ aiConfig: { model: 'openai/gpt', provider: 'openai' }, byo: false, workspaceId: 'ws' });
    streamChat.mockReturnValue(gen([
      { type: 'content', content: 'Updating the headline.\n```diff\n--- index.html\n+++ index.html\n-<h1>Old</h1>\n+<h1>New</h1>\n```' },
      { type: 'done', usage: { input_tokens: 5, output_tokens: 9 } },
    ]));
    applyEditsToPending.mockResolvedValue([{ file: 'index.html', success: true }]);

    const res = await proposeEdit(env, 'a1', 'change the headline');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.files).toEqual(['index.html']);
      expect(res.conversationId).toBeTruthy();
      expect(res.explanation).toMatch(/headline/i);
      expect(res.explanation).not.toMatch(/```/); // diff stripped
    }
    expect(applyEditsToPending).toHaveBeenCalled();
    expect(recordAgentUsage).toHaveBeenCalled();
  });

  it('returns no files (just the answer) when the agent stages nothing', async () => {
    resolveAgentAiConfig.mockResolvedValue({ aiConfig: { model: 'gpt', provider: 'openai' }, byo: false, workspaceId: 'ws' });
    streamChat.mockReturnValue(gen([
      { type: 'content', content: 'Which headline did you mean?' },
      { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } },
    ]));
    const res = await proposeEdit(env, 'a1', 'change it');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.files).toEqual([]);
    expect(applyEditsToPending).not.toHaveBeenCalled();
  });
});

describe('publishEdits', () => {
  it('delegates to publishConversation and returns the URL', async () => {
    publishConversation.mockResolvedValue({ ok: true, url: 'https://shareout.site/a/page', versionId: 'v', versionNo: 2, appliedEdits: 1 });
    const res = await publishEdits(env, 'a1', 'conv_1');
    expect(res).toEqual({ ok: true, url: 'https://shareout.site/a/page' });
  });
});
