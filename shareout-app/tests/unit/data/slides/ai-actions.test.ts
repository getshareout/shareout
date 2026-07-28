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


describe('slide ai actions', () => {
  beforeEach(() => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    vi.mocked(getBuildConfig).mockReturnValue({ provider: 'openai', apiKey: 'k', baseUrl: 'http://x', model: 'm' });
    vi.mocked(chat).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const aiPath = `${PRES_ID}/slides/${SLIDE_ID_1}/ai`;

  it('rewrites slide content and strips fences', async () => {
    vi.mocked(chat).mockResolvedValue({
      content: '```html\n<div>Rewritten</div>\n```',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const { db, store } = seedPresentationWithSlides();
    const res = await handleSlides(jsonRequest('POST', aiPath, { action: 'rewrite' }), makeCtx(db), aiPath);
    expect(res.status).toBe(200);
    expect(store.slides.find((s) => s.id === SLIDE_ID_1)?.content).toBe('<div>Rewritten</div>');
  });

  it('generates and saves speaker notes', async () => {
    vi.mocked(chat).mockResolvedValue({ content: 'Talk about X', usage: { input_tokens: 1, output_tokens: 1 } });
    const { db } = seedPresentationWithSlides();
    const res = await handleSlides(jsonRequest('POST', aiPath, { action: 'generateNotes' }), makeCtx(db), aiPath);
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.data?.notes).toBe('Talk about X');
  });

  it('suggests a layout without mutating content', async () => {
    vi.mocked(chat).mockResolvedValue({ content: 'Use bigStat.', usage: { input_tokens: 1, output_tokens: 1 } });
    const { db, store } = seedPresentationWithSlides();
    const before = store.slides.find((s) => s.id === SLIDE_ID_1)?.content;
    const res = await handleSlides(jsonRequest('POST', aiPath, { action: 'suggestLayout' }), makeCtx(db), aiPath);
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.data?.suggestion).toBe('Use bigStat.');
    expect(store.slides.find((s) => s.id === SLIDE_ID_1)?.content).toBe(before);
  });

  it('rejects an invalid action', async () => {
    const { db } = seedPresentationWithSlides();
    const res = await handleSlides(jsonRequest('POST', aiPath, { action: 'nope' }), makeCtx(db), aiPath);
    expect(res.status).toBe(400);
  });

  it('returns 503 when AI is not configured', async () => {
    vi.mocked(getBuildConfig).mockReturnValue(null);
    const { db } = seedPresentationWithSlides();
    const res = await handleSlides(jsonRequest('POST', aiPath, { action: 'rewrite' }), makeCtx(db), aiPath);
    expect(res.status).toBe(503);
  });

  it('returns 404 for a missing slide', async () => {
    const { db } = seedPresentationWithSlides();
    const missing = `${PRES_ID}/slides/slide_${'f'.repeat(24)}/ai`;
    const res = await handleSlides(jsonRequest('POST', missing, { action: 'rewrite' }), makeCtx(db), missing);
    expect(res.status).toBe(404);
  });

  it('sanitizes upstream AI errors in AI_ERROR responses', async () => {
    vi.mocked(chat).mockRejectedValue(new Error('AI API error: 401 {"error":"invalid_api_key"}'));
    const { db } = seedPresentationWithSlides();
    const res = await handleSlides(jsonRequest('POST', aiPath, { action: 'rewrite' }), makeCtx(db), aiPath);
    expect(res.status).toBe(502);
    const body = await parseJson(res);
    expect(body.error).toBe('AI request failed');
    expect(JSON.stringify(body)).not.toContain('invalid_api_key');
  });
});

