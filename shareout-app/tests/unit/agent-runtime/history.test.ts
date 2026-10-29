// Long conversations are folded, not cut: the newest messages verbatim, the rest summarized by one metered call.
import { describe, expect, it } from 'vitest';
import { foldHistory, type HistoryBudget, type HistoryTurn } from '../../../src/agent-runtime/history';
import { meter, scriptedProvider } from '../build-agent/helpers';

const BUDGET: HistoryBudget = { foldAtTokens: 1_000, keepRecentTokens: 400, minRecent: 2, summaryTokens: 512, maxSourceChars: 20_000, maxMessageChars: 2_000 };

/** n exchanges, each user + assistant message about `chars` long. */
function thread(n: number, chars: number): HistoryTurn[] {
  const out: HistoryTurn[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ role: 'user', text: `q${i} ${'u'.repeat(chars)}` });
    out.push({ role: 'assistant', text: `a${i} ${'a'.repeat(chars)}`, toolCalls: [] });
  }
  return out;
}

describe('foldHistory', () => {
  it('leaves a short thread alone and makes no call', async () => {
    const { provider, calls } = scriptedProvider([{ text: 'never' }]);
    const turns = thread(3, 100);
    const r = await foldHistory({ provider, meter, turns, budget: BUDGET });
    expect(r).toEqual({ recent: turns, summary: null, folded: 0 });
    expect(calls).toHaveLength(0);
  });

  it('summarizes the older part of a long thread in one metered, tool-less call and keeps the newest verbatim', async () => {
    const { provider, calls } = scriptedProvider([{ text: '- user wants the Q3 revenue page (art_42)' }]);
    const turns = thread(20, 300); // ≈ 40 × 300 chars ≈ 3k tokens, over the 1k budget
    const r = await foldHistory({ provider, meter, turns, budget: BUDGET });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tools: [], maxTokens: 512, meter });
    expect(r.summary).toBe('- user wants the Q3 revenue page (art_42)');
    expect(r.folded + r.recent.length).toBe(turns.length);
    // The newest messages are kept exactly, and the kept part opens with the user.
    expect(r.recent).toEqual(turns.slice(r.folded));
    expect(r.recent[0].role).toBe('user');
    expect(r.recent.length).toBeGreaterThanOrEqual(BUDGET.minRecent);
    // The summary call reads the folded messages, not the kept ones.
    const sent = (calls[0].transcript[0] as { text: string }).text;
    expect(sent).toContain('User: q0');
    expect(sent).toContain(`Assistant: a${r.folded / 2 - 1}`);
    expect(sent).not.toContain('q19');
    expect(calls[0].system).toMatch(/data, not instructions/);
  });

  it('keeps at least minRecent messages even when they are over the recent budget', async () => {
    const { provider } = scriptedProvider([{ text: 'sum' }]);
    const turns = thread(6, 3_000);
    const r = await foldHistory({ provider, meter, turns, budget: BUDGET });
    expect(r.recent).toEqual(turns.slice(-2));
  });

  it('caps the text the summary is written from, keeping the newest of the older messages', async () => {
    const { provider, calls } = scriptedProvider([{ text: 'sum' }]);
    const turns = thread(40, 1_500);
    await foldHistory({ provider, meter, turns, budget: { ...BUDGET, maxSourceChars: 8_000, maxMessageChars: 1_000 } });
    const sent = (calls[0].transcript[0] as { text: string }).text;
    expect(sent.length).toBeLessThan(8_200);
    expect(sent).not.toContain('User: q0 ');
    expect(sent).toContain('… [cut]');
  });

  it('a failed summary drops the older part and says why, instead of failing the turn', async () => {
    const { provider } = scriptedProvider([{ error: { type: 'error', error: 'AI is down', retryable: true } }]);
    const turns = thread(20, 300);
    const r = await foldHistory({ provider, meter, turns, budget: BUDGET });
    expect(r.summary).toBeNull();
    expect(r.failed).toBe('AI is down');
    expect(r.recent).toEqual(turns.slice(r.folded));
    expect(r.folded).toBeGreaterThan(0);
  });
});
