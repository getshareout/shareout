// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleEditorChat } from '../../../src/editor/chat/index';
import type { EditorContext } from '../../../src/editor/index';
import type { Env } from '../../../src/types';
import {
  ARTIFACT_ID,
  USER_ID,
  editorAnthropicDoneStream,
  editorAnthropicStopStream,
  editorOpenAIDoneStream,
  editorOpenAIStopStream,
  makeCtx,
  makeDbMock,
  parseSSEEvents,
  readSSE,
} from './chat-helpers';

vi.mock('../../../src/crypto-utils', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_testid000000000001`),
}));

// The editor-AI feature gate is out of scope here; treat it as enabled so the
// chat handler runs without an extra DB read against the strict mock.
vi.mock('../../../src/features/flags', () => ({
  isArtifactFeatureEnabled: vi.fn().mockResolvedValue(true),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

function openaiEnv(dbHandlers: Parameters<typeof makeDbMock>[0] = {}): Env {
  return {
    OPENAI_API_KEY: 'sk-openai-test',
    DB: makeDbMock(dbHandlers),
  } as Env;
}

function anthropicEnv(dbHandlers: Parameters<typeof makeDbMock>[0] = {}): Env {
  return {
    ANTHROPIC_API_KEY: 'sk-ant-test',
    DB: makeDbMock(dbHandlers),
  } as Env;
}

function gatewayEnv(dbHandlers: Parameters<typeof makeDbMock>[0] = {}): Env {
  return {
    VERCEL_AI_GATEWAY: 'gw-test-key',
    ANTHROPIC_API_KEY: 'sk-ant-should-not-use',
    OPENAI_API_KEY: 'sk-openai-should-not-use',
    DB: makeDbMock(dbHandlers),
  } as Env;
}

function noAiEnv(): Env {
  return { DB: makeDbMock() } as Env;
}

async function chatRequest(
  ctx: EditorContext,
  mode: string,
  body: unknown,
  method = 'POST',
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
  };
  if (method === 'POST' && body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return handleEditorChat(
    new Request('https://shareout.test/v1/artifacts/art/editor/chat', init),
    ctx,
    mode,
  );
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

const agentReplyPatches = JSON.stringify({
  reply: 'Updated the heading.',
  changes: {
    patches: [{ selector: 'h1.title', action: 'replace', content: '<h1 class="title">Hello</h1>' }],
  },
});

const agentReplyHtml = JSON.stringify({
  reply: 'Replaced the section.',
  changes: { html: '<section id="hero">New</section>' },
});

const agentReplyExplanation = JSON.stringify({
  reply: 'The page uses flexbox for layout.',
  changes: null,
});

const legacyPatches = JSON.stringify({
  patches: [{ selector: 'p', action: 'setStyle', value: 'red', attribute: 'color' }],
  message: 'Styled paragraph.',
});

const legacyHtml = JSON.stringify({
  html: '<div>legacy</div>',
  message: 'Full replace.',
});

describe('handleEditorChat routing', () => {
  it('returns 405 for non-POST methods', async () => {
    const res = await chatRequest(makeCtx(openaiEnv()), 'normal', { prompt: 'hi' }, 'GET');
    expect(res.status).toBe(405);
    await expect(jsonBody(res)).resolves.toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
  });

  it('returns 400 for unknown chat mode', async () => {
    const res = await chatRequest(makeCtx(openaiEnv()), 'unknown-mode', { prompt: 'hi' });
    expect(res.status).toBe(400);
    await expect(jsonBody(res)).resolves.toMatchObject({ code: 'INVALID_MODE' });
  });
});

describe('normal chat', () => {
  it('requires prompt', async () => {
    const res = await chatRequest(makeCtx(openaiEnv()), 'normal', {
      prompt: '',
      context: { documentHtml: '<html></html>' },
    });
    expect(res.status).toBe(400);
    await expect(jsonBody(res)).resolves.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('returns 400 when request body is invalid JSON', async () => {
    const res = await handleEditorChat(
      new Request('https://test', { method: 'POST', body: 'not-json' }),
      makeCtx(openaiEnv()),
      'normal',
    );
    expect(res.status).toBe(400);
    await expect(jsonBody(res)).resolves.toMatchObject({ code: 'INVALID_JSON' });
  });

  it('streams SSE error when no AI provider is configured', async () => {
    const res = await chatRequest(makeCtx(noAiEnv()), 'normal', {
      prompt: 'Make it blue',
      context: { documentHtml: '<body></body>' },
    });
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const events = parseSSEEvents(await readSSE(res));
    expect(events[0]).toEqual({ type: 'error', error: 'AI not configured' });
  });

  it('streams content and done via OpenAI [DONE] with patch response', async () => {
    const run = vi.fn(async () => ({ success: true }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(editorOpenAIDoneStream(agentReplyPatches), { status: 200 }),
    );

    const res = await chatRequest(makeCtx(openaiEnv({ run })), 'normal', {
      prompt: 'Update the title',
      context: {
        documentHtml: '<h1 class="title">Old</h1>',
        artifact: { id: ARTIFACT_ID, name: 'Landing', slug: 'landing', description: 'Home page' },
        outline: {
          nodes: [
            { id: 'n1', label: 'Hero', type: 'section', selector: '#hero', depth: 0 },
            { id: 'n2', label: 'Features', type: 'section', selector: '#features', depth: 1 },
          ],
          totalPages: 1,
          totalSections: 2,
        },
        selection: {
          selector: 'h1.title',
          tagName: 'h1',
          id: 'main-title',
          classes: ['title'],
          textPreview: 'Old heading text',
          siblingCount: 0,
          parentSelector: 'header',
          computedStyles: {
            fontSize: '32px',
            color: '#111',
            backgroundColor: 'transparent',
            padding: '0',
            margin: '0',
            display: 'block',
          },
        },
        htmlMode: 'subtree',
      },
    });

    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const events = parseSSEEvents(await readSSE(res));
    expect(events.some((e) => e.type === 'content')).toBe(true);
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done?.changeId).toBe('chg_testid000000000001');
    expect(done?.response).toMatchObject({
      type: 'html_patch',
      message: 'Updated the heading.',
    });
    expect(run).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-openai-test' }),
      }),
    );
  });

  it('completes via OpenAI finish_reason=stop', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(editorOpenAIStopStream(agentReplyExplanation), { status: 200 }),
    );

    const res = await chatRequest(makeCtx(openaiEnv()), 'normal', {
      prompt: 'Explain layout',
      context: { documentHtml: '<main></main>' },
    });

    const events = parseSSEEvents(await readSSE(res));
    const done = events.find((e) => e.type === 'done');
    expect(done?.response).toMatchObject({ type: 'explanation' });
  });

  it('streams via Anthropic message_stop', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(editorAnthropicStopStream(agentReplyHtml), { status: 200 }),
    );

    const res = await chatRequest(makeCtx(anthropicEnv()), 'normal', {
      prompt: 'Replace hero',
      context: { documentHtml: '<section id="hero"></section>' },
    });

    const events = parseSSEEvents(await readSSE(res));
    const done = events.find((e) => e.type === 'done');
    expect(done?.response).toMatchObject({ type: 'full_replace' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'sk-ant-test' }),
      }),
    );
  });

  it('streams via Anthropic [DONE] signal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(editorAnthropicDoneStream(legacyPatches), { status: 200 }),
    );

    const res = await chatRequest(makeCtx(anthropicEnv()), 'normal', {
      prompt: 'Style text',
      context: { documentHtml: '<p>Hi</p>' },
    });

    const events = parseSSEEvents(await readSSE(res));
    const done = events.find((e) => e.type === 'done');
    expect(done?.response).toMatchObject({ type: 'html_patch', message: 'Styled paragraph.' });
  });

  it('parses JSON wrapped in markdown code fences', async () => {
    const fenced = '```json\n' + agentReplyPatches + '\n```';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(editorOpenAIDoneStream(fenced), { status: 200 }),
    );

    const res = await chatRequest(makeCtx(openaiEnv()), 'normal', {
      prompt: 'Fix',
      context: { documentHtml: '<h1></h1>' },
    });

    const done = parseSSEEvents(await readSSE(res)).find((e) => e.type === 'done');
    expect(done?.response).toMatchObject({ type: 'html_patch' });
  });

  it('treats non-JSON model output as explanation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(editorOpenAIDoneStream('Just plain text, no JSON here.'), { status: 200 }),
    );

    const res = await chatRequest(makeCtx(openaiEnv()), 'normal', {
      prompt: 'What is this?',
      context: { documentHtml: '<div></div>' },
    });

    const done = parseSSEEvents(await readSSE(res)).find((e) => e.type === 'done');
    expect(done?.response).toMatchObject({
      type: 'explanation',
      message: 'Just plain text, no JSON here.',
    });
  });

  it('emits SSE error on API failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));

    const res = await chatRequest(makeCtx(openaiEnv()), 'normal', {
      prompt: 'Hi',
      context: { documentHtml: '' },
    });

    const events = parseSSEEvents(await readSSE(res));
    expect(events[0]).toMatchObject({ type: 'error', error: expect.stringContaining('429') });
  });

  it('emits SSE error when API response has no body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    const res = await chatRequest(makeCtx(openaiEnv()), 'normal', {
      prompt: 'Hi',
      context: { documentHtml: '' },
    });

    const events = parseSSEEvents(await readSSE(res));
    expect(events[0]).toEqual({ type: 'error', error: 'No response' });
  });

  it('emits stream error when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));

    const res = await chatRequest(makeCtx(openaiEnv()), 'normal', {
      prompt: 'Hi',
      context: { documentHtml: '' },
    });

    const events = parseSSEEvents(await readSSE(res));
    expect(events[0]).toEqual({ type: 'error', error: 'Stream failed' });
  });

  it('skips malformed SSE JSON lines', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode('data: not-json\n\n'));
        c.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: legacyHtml } }] })}\n\n`));
        c.enqueue(encoder.encode('data: [DONE]\n\n'));
        c.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));

    const res = await chatRequest(makeCtx(openaiEnv()), 'normal', {
      prompt: 'Replace',
      context: { documentHtml: '<div></div>' },
    });

    const done = parseSSEEvents(await readSSE(res)).find((e) => e.type === 'done');
    expect(done?.response).toMatchObject({ type: 'full_replace' });
  });

  it('uses Vercel AI Gateway when configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(editorOpenAIDoneStream(agentReplyExplanation), { status: 200 }),
    );

    await chatRequest(makeCtx(gatewayEnv()), 'normal', {
      prompt: 'Explain',
      context: { documentHtml: '<body></body>' },
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://ai-gateway.vercel.sh/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer gw-test-key' }),
      }),
    );
  });
});

describe('inline chat', () => {
  it('requires prompt and inlineSelection', async () => {
    const missingPrompt = await chatRequest(makeCtx(openaiEnv()), 'inline', {
      prompt: '',
      context: { documentHtml: '<p></p>' },
    });
    expect(missingPrompt.status).toBe(400);

    const missingSelection = await chatRequest(makeCtx(openaiEnv()), 'inline', {
      prompt: 'Bold this',
      context: { documentHtml: '<p>text</p>' },
    });
    expect(missingSelection.status).toBe(400);
  });

  it('streams inline edits with text range in system prompt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(editorOpenAIDoneStream(legacyPatches), { status: 200 }),
    );

    const res = await chatRequest(makeCtx(openaiEnv()), 'inline', {
      prompt: 'Emphasize selection',
      context: {
        documentHtml: '<p id="lead">Hello world</p>',
        inlineSelection: { selector: '#lead', textRange: [0, 5] },
      },
    });

    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const done = parseSSEEvents(await readSSE(res)).find((e) => e.type === 'done');
    expect(done?.changeId).toBe('chg_testid000000000001');
  });

  it('returns 400 on invalid JSON body', async () => {
    const res = await handleEditorChat(
      new Request('https://test', { method: 'POST', body: '{' }),
      makeCtx(openaiEnv()),
      'inline',
    );
    expect(res.status).toBe(400);
    await expect(jsonBody(res)).resolves.toMatchObject({ code: 'INVALID_JSON' });
  });
});

describe('lasso chat', () => {
  const lassoImage = 'data:image/png;base64,iVBORw0KGgo=';

  it('requires prompt and lassoImage', async () => {
    const res = await chatRequest(makeCtx(openaiEnv()), 'lasso', {
      prompt: 'Change color',
      context: { documentHtml: '<div></div>' },
    });
    expect(res.status).toBe(400);
    await expect(jsonBody(res)).resolves.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('streams vision response via OpenAI gateway path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(editorOpenAIStopStream(agentReplyPatches), { status: 200 }),
    );

    const res = await chatRequest(makeCtx(openaiEnv()), 'lasso', {
      prompt: 'Make button larger',
      context: {
        documentHtml: '<button>Go</button>',
        lassoImage,
        lassoElementsHtml: '<button class="cta">Go</button>',
        lassoElementsCount: 1,
        lassoBounds: { x: 10, y: 20, w: 100, h: 40 },
        artifact: { id: ARTIFACT_ID, name: 'App', slug: 'app' },
        outline: {
          nodes: [{ id: 'o1', label: 'CTA', type: 'section', selector: '.cta', depth: 0 }],
          totalPages: 1,
          totalSections: 1,
        },
      },
    });

    const events = parseSSEEvents(await readSSE(res));
    expect(events.some((e) => e.type === 'content')).toBe(true);
    const done = events.find((e) => e.type === 'done');
    expect(done?.response).toMatchObject({ type: 'html_patch' });

    const body = JSON.parse(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body));
    const userContent = body.messages[1].content;
    expect(userContent.some((p: { type: string }) => p.type === 'image_url')).toBe(true);
  });

  it('streams vision response via Anthropic API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(editorAnthropicStopStream(agentReplyExplanation), { status: 200 }),
    );

    const res = await chatRequest(makeCtx(anthropicEnv()), 'lasso', {
      prompt: 'What is selected?',
      context: {
        documentHtml: '<span>item</span>',
        lassoImage: 'iVBORw0KGgo=',
      },
    });

    const events = parseSSEEvents(await readSSE(res));
    expect(events.find((e) => e.type === 'done')?.response).toMatchObject({ type: 'explanation' });

    const body = JSON.parse(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body));
    const imageBlock = body.messages[0].content.find((p: { type: string }) => p.type === 'image');
    expect(imageBlock.source.media_type).toBe('image/png');
  });

  it('emits SSE error when vision API fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad', { status: 500 }));

    const res = await chatRequest(makeCtx(openaiEnv()), 'lasso', {
      prompt: 'Fix',
      context: { documentHtml: '', lassoImage },
    });

    const events = parseSSEEvents(await readSSE(res));
    expect(events[0]).toMatchObject({ type: 'error', error: expect.stringContaining('500') });
  });

  it('emits error when no AI provider for lasso', async () => {
    const res = await chatRequest(makeCtx(noAiEnv()), 'lasso', {
      prompt: 'Fix',
      context: { documentHtml: '', lassoImage },
    });

    const events = parseSSEEvents(await readSSE(res));
    expect(events[0]).toEqual({ type: 'error', error: 'AI not configured' });
  });

  it('returns 400 when lasso body is invalid JSON', async () => {
    const res = await handleEditorChat(
      new Request('https://test', { method: 'POST', body: '{' }),
      makeCtx(openaiEnv()),
      'lasso',
    );
    expect(res.status).toBe(400);
    await expect(jsonBody(res)).resolves.toMatchObject({ code: 'INVALID_JSON' });
  });
});

describe('apply and reject changes', () => {
  it('requires changeId', async () => {
    const applyRes = await chatRequest(makeCtx(openaiEnv()), 'apply', {});
    expect(applyRes.status).toBe(400);

    const rejectRes = await chatRequest(makeCtx(openaiEnv()), 'reject', {});
    expect(rejectRes.status).toBe(400);
  });

  it('marks pending change as applied', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const res = await chatRequest(makeCtx(openaiEnv({ run })), 'apply', { changeId: 'chg_abc' });

    expect(res.status).toBe(200);
    await expect(jsonBody(res)).resolves.toEqual({ success: true, message: 'Changes applied' });
    expect(run).toHaveBeenCalled();
    const sql = String(run.mock.calls[0][0]);
    expect(sql).toContain("status = 'applied'");
  });

  it('marks pending change as rejected', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const res = await chatRequest(makeCtx(openaiEnv({ run })), 'reject', { changeId: 'chg_xyz' });

    expect(res.status).toBe(200);
    await expect(jsonBody(res)).resolves.toEqual({ success: true, message: 'Changes rejected' });
    const sql = String(run.mock.calls[0][0]);
    expect(sql).toContain("status = 'rejected'");
  });

  it('returns 500 when apply DB update fails', async () => {
    const res = await chatRequest(
      makeCtx({
        ...openaiEnv(),
        DB: {
          prepare: () => ({
            bind: () => ({
              run: async () => {
                throw new Error('db down');
              },
            }),
          }),
        } as unknown as Env['DB'],
      }),
      'apply',
      { changeId: 'chg_fail' },
    );
    expect(res.status).toBe(500);
    await expect(jsonBody(res)).resolves.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('returns 400 when apply body is invalid JSON', async () => {
    const res = await handleEditorChat(
      new Request('https://test', { method: 'POST', body: 'not-json' }),
      makeCtx(openaiEnv()),
      'apply',
    );
    expect(res.status).toBe(400);
    await expect(jsonBody(res)).resolves.toMatchObject({ code: 'INVALID_JSON' });
  });

  it('returns 400 when reject body is invalid JSON', async () => {
    const res = await handleEditorChat(
      new Request('https://test', { method: 'POST', body: 'not-json' }),
      makeCtx(openaiEnv()),
      'reject',
    );
    expect(res.status).toBe(400);
    await expect(jsonBody(res)).resolves.toMatchObject({ code: 'INVALID_JSON' });
  });
});

describe('AI provider priority', () => {
  it('prefers gateway over direct Anthropic and OpenAI keys', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(editorOpenAIDoneStream(agentReplyExplanation), { status: 200 }),
    );

    await chatRequest(makeCtx(gatewayEnv()), 'normal', {
      prompt: 'test',
      context: { documentHtml: '' },
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('ai-gateway.vercel.sh'),
      expect.anything(),
    );
  });

  it('uses Anthropic when gateway absent but Anthropic key present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(editorAnthropicDoneStream(agentReplyExplanation), { status: 200 }),
    );

    await chatRequest(makeCtx(anthropicEnv()), 'normal', {
      prompt: 'test',
      context: { documentHtml: '' },
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.anything(),
    );
  });
});
