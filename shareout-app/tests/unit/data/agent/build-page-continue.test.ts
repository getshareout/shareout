// A build that hits the output cap is continued, never published cut off mid-<script>.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../../src/types';
import type { ChatChunk } from '../../../../src/data/agent/types';

const streamChat = vi.hoisted(() => vi.fn());
const alertOps = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../../src/support/alert', () => ({ alertOps }));
vi.mock('../../../../src/data/agent/anthropic', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  streamChat,
  getBuildConfig: vi.fn(() => null),
}));

import {
  BUILD_CONTINUATIONS, BUILD_TRUNCATED_CODE, BuildTruncatedError, generateArtifactHtml, streamBuild,
  type BuildChunk,
} from '../../../../src/data/agent/build-page';

const env = { SHAREOUT_BASE_URL: 'https://shareout.example' } as unknown as Env;
const meter = { workspaceId: null, userId: 'u1', kind: 'page_build', source: 'test' };

/** One streamChat call: the text in a few deltas, then `done` (truncated or not). */
function turn(text: string, truncated: boolean) {
  return async function* (): AsyncGenerator<ChatChunk> {
    for (let i = 0; i < text.length; i += 7) yield { type: 'content', content: text.slice(i, i + 7) };
    yield { type: 'done', usage: { input_tokens: 1, output_tokens: 1 }, ...(truncated ? { truncated } : {}) };
  };
}

async function collect(gen: AsyncGenerator<BuildChunk>) {
  const out: BuildChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

const PROMPT = [{ role: 'user' as const, content: 'build me a page' }];

beforeEach(() => { streamChat.mockReset(); alertOps.mockClear(); });

describe('streamBuild', () => {
  it('a page that fits takes one call', async () => {
    const page = '<!DOCTYPE html><html><body><script>ok()</script></body></html>';
    streamChat.mockImplementationOnce(turn(page, false));
    const out = await collect(streamBuild(env, meter, PROMPT, 'sys', null));
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(out.at(-1)).toEqual({ type: 'done', raw: page });
    expect(out.filter((c) => c.type === 'delta').map((c) => (c as { text: string }).text).join('')).toBe(page);
  });

  it('continues a cut-off page and stitches the parts', async () => {
    const head = "<!DOCTYPE html><html><body><script>toast('No se pud";
    const tail = "o guardar.')</script></body></html>";
    streamChat.mockImplementationOnce(turn(head, true)).mockImplementationOnce(turn('```html\n' + tail + '\n```', false));
    const out = await collect(streamBuild(env, meter, PROMPT, 'sys', null));
    expect(streamChat).toHaveBeenCalledTimes(2);
    expect(out.at(-1)).toEqual({ type: 'done', raw: head + tail });
    // The continuation turn carries the partial page back as the assistant's own words.
    const convo = streamChat.mock.calls[1][2];
    expect(convo.slice(0, 2)).toEqual([PROMPT[0], { role: 'assistant', content: head }]);
    expect(convo[2].role).toBe('user');
    // The live preview gets the continuation too (fence stripped).
    const streamed = out.filter((c) => c.type === 'delta').map((c) => (c as { text: string }).text).join('');
    expect(streamed.startsWith(head + 'o guardar')).toBe(true);
  });

  it('takes a continuation that restarts the document instead of appending it', async () => {
    const full = '<!DOCTYPE html><html><body><p>whole page again</p></body></html>';
    streamChat.mockImplementationOnce(turn('<!DOCTYPE html><html><body><p>who', true)).mockImplementationOnce(turn(full, false));
    const out = await collect(streamBuild(env, meter, PROMPT, 'sys', null));
    expect(out.at(-1)).toEqual({ type: 'done', raw: full });
  });

  it('gives up after the last continuation with BUILD_TRUNCATED, no page', async () => {
    for (let i = 0; i <= BUILD_CONTINUATIONS; i++) streamChat.mockImplementationOnce(turn(`<p>part ${i} of a very long page `, true));
    const out = await collect(streamBuild(env, meter, PROMPT, 'sys', null));
    expect(streamChat).toHaveBeenCalledTimes(BUILD_CONTINUATIONS + 1);
    expect(out.some((c) => c.type === 'done')).toBe(false);
    expect(out.at(-1)).toMatchObject({ type: 'error', code: BUILD_TRUNCATED_CODE });
    expect(alertOps).toHaveBeenCalledTimes(1);
    expect(alertOps.mock.calls[0][1]).toMatch(/cut off/);
    expect((alertOps.mock.calls[0][2] as string[]).join('\n')).toMatch(/Asked for: build me a page/);
  });

  it('passes a provider error straight through without continuing', async () => {
    streamChat.mockImplementationOnce(async function* () { yield { type: 'error', error: 'boom', code: 'workspace_budget', resets_at: 'x' }; });
    const out = await collect(streamBuild(env, meter, PROMPT, 'sys', null));
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(out).toEqual([{ type: 'error', error: 'boom', code: 'workspace_budget', resets_at: 'x' }]);
    // The workspace's own AI budget is not a broken build: no alert.
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('alerts the operator when the model itself fails mid-build', async () => {
    streamChat.mockImplementationOnce(async function* () { yield { type: 'error', error: 'gateway 502' }; });
    const out = await collect(streamBuild(env, meter, PROMPT, 'sys', null));
    expect(out.at(-1)).toMatchObject({ type: 'error', error: 'gateway 502' });
    expect(alertOps).toHaveBeenCalledTimes(1);
    expect(alertOps.mock.calls[0][1]).toMatch(/model error/);
  });
});

describe('generateArtifactHtml', () => {
  it('returns the stitched page', async () => {
    streamChat.mockImplementationOnce(turn('<!DOCTYPE html><html><body><p>a', true)).mockImplementationOnce(turn('bc</p></body></html>', false));
    await expect(generateArtifactHtml(env, 'p', meter)).resolves.toBe('<!DOCTYPE html><html><body><p>abc</p></body></html>');
  });

  it('throws BuildTruncatedError when the page never finishes', async () => {
    for (let i = 0; i <= BUILD_CONTINUATIONS; i++) streamChat.mockImplementationOnce(turn('<!DOCTYPE html><html><body><p>more and more text', true));
    await expect(generateArtifactHtml(env, 'p', meter)).rejects.toBeInstanceOf(BuildTruncatedError);
  });
});
