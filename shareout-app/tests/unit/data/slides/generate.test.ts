// @vitest-environment node
import './setup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let idSeq = 0;

vi.mock('../../../../src/data/slides/realtime', () => ({
  broadcastEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/data/agent/anthropic', () => ({
  getBuildConfig: vi.fn(() => ({ provider: 'openai', apiKey: 'k', baseUrl: 'http://x', model: 'm' })),
  chat: vi.fn(),
}));

vi.mock('../../../../src/crypto-utils', () => ({
  generateId: vi.fn((prefix: string) => {
    idSeq += 1;
    const hex = idSeq.toString(16).padStart(24, '0').slice(-24);
    return `${prefix}_${hex}`;
  }),
}));
import * as middleware from '../../../../src/data/middleware';
import { handleSlides } from '../../../../src/data/slides/handler';
import { broadcastEvent } from '../../../../src/data/slides/realtime';
import {
  ARTIFACT_ID,
  BASE_URL,
  MAX_CONTENT_LENGTH,
  MAX_SLIDES_PER_PRESENTATION,
  MAX_VERSIONS_PER_PRESENTATION,
  PRES_ID,
  SLIDE_ID_1,
  SLIDE_ID_2,
  VER_ID,
  createSlidesDb,
  jsonRequest,
  makeCtx,
  makePresentation,
  makeSlide,
  parseJson,
  seedPresentationWithSlides,
  type StoredVersion,
} from './shared';
import { chat, getBuildConfig } from '../../../../src/data/agent/anthropic';


describe('slides generate', () => {
  beforeEach(() => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    vi.mocked(getBuildConfig).mockReturnValue({ provider: 'openai', apiKey: 'k', baseUrl: 'http://x', model: 'm' });
    vi.mocked(chat).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function genCtx() {
    const { db } = createSlidesDb();
    return makeCtx(db);
  }

  it('generates a deck outline from a prompt', async () => {
    vi.mocked(chat).mockResolvedValue({
      content: JSON.stringify({
        title: 'Coffee 101',
        slides: [
          { layout: 'title', title: 'Coffee 101' },
          { layout: 'bigStat', value: '2B', label: 'cups/day' },
        ],
      }),
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const res = await handleSlides(jsonRequest('POST', 'generate', { prompt: 'Coffee' }), genCtx(), 'generate');
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.data?.title).toBe('Coffee 101');
    expect(body.data?.count).toBe(2);
  });

  it('drops slides with unknown layouts', async () => {
    vi.mocked(chat).mockResolvedValue({
      content: '```json\n' + JSON.stringify({
        slides: [
          { layout: 'title', title: 'A' },
          { layout: 'bogus', foo: 1 },
          { html: '<x/>' },
        ],
      }) + '\n```',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const res = await handleSlides(jsonRequest('POST', 'generate', { prompt: 'x' }), genCtx(), 'generate');
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.data?.count).toBe(2);
  });

  it('requires a prompt', async () => {
    const res = await handleSlides(jsonRequest('POST', 'generate', { prompt: '  ' }), genCtx(), 'generate');
    expect(res.status).toBe(400);
  });

  it('forbids generation without ownership', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const res = await handleSlides(jsonRequest('POST', 'generate', { prompt: 'x' }), genCtx(), 'generate');
    expect(res.status).toBe(403);
  });

  it('returns 503 when AI is not configured', async () => {
    vi.mocked(getBuildConfig).mockReturnValue(null);
    const res = await handleSlides(jsonRequest('POST', 'generate', { prompt: 'x' }), genCtx(), 'generate');
    expect(res.status).toBe(503);
  });

  it('returns 502 on non-JSON model output', async () => {
    vi.mocked(chat).mockResolvedValue({ content: 'sorry, no', usage: { input_tokens: 1, output_tokens: 1 } });
    const res = await handleSlides(jsonRequest('POST', 'generate', { prompt: 'x' }), genCtx(), 'generate');
    expect(res.status).toBe(502);
  });

  it('sanitizes upstream AI errors in AI_ERROR responses', async () => {
    vi.mocked(chat).mockRejectedValue(new Error('AI API error: 500 internal provider body'));
    const res = await handleSlides(jsonRequest('POST', 'generate', { prompt: 'x' }), genCtx(), 'generate');
    expect(res.status).toBe(502);
    const body = await parseJson(res);
    expect(body.error).toBe('AI request failed');
    expect(JSON.stringify(body)).not.toContain('internal provider body');
  });
});

