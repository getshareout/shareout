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
import { mapPresentation } from '../../../../src/data/slides/db';
import { buildSlideHtml, buildDeckHtml } from '../../../../src/data/slides/export';


describe('slide export', () => {
  function getReq(pathWithQuery: string): Request {
    return new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/slides/${pathWithQuery}`, { method: 'GET' });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buildSlideHtml sizes the slide to deck dimensions', () => {
    const pres = mapPresentation(makePresentation({ id: PRES_ID, width: 1280, height: 720 }));
    const html = buildSlideHtml(pres, '<h1>Hi</h1>');
    expect(html).toContain('width:1280px');
    expect(html).toContain('<h1>Hi</h1>');
  });

  it('buildDeckHtml emits one slide block per content with @page sizing', () => {
    const pres = mapPresentation(makePresentation({ id: PRES_ID }));
    const html = buildDeckHtml(pres, ['<p>A</p>', '<p>B</p>']);
    expect(html.match(/class="slide"/g)).toHaveLength(2);
    expect(html).toContain('@page');
  });

  it('rejects an invalid format', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    const { db } = seedPresentationWithSlides();
    const res = await handleSlides(getReq(`${PRES_ID}/export?format=gif`), makeCtx(db), `${PRES_ID}/export`);
    expect(res.status).toBe(400);
  });

  it('forbids export without edit permission', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const { db } = seedPresentationWithSlides();
    const res = await handleSlides(getReq(`${PRES_ID}/export?format=pdf`), makeCtx(db), `${PRES_ID}/export`);
    expect(res.status).toBe(403);
  });

  it('returns 404 when the presentation is missing', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    const { db } = createSlidesDb();
    const res = await handleSlides(getReq(`${PRES_ID}/export?format=pdf`), makeCtx(db), `${PRES_ID}/export`);
    expect(res.status).toBe(404);
  });

  it('returns 503 when browser rendering is unavailable', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    const { db } = seedPresentationWithSlides();
    const res = await handleSlides(getReq(`${PRES_ID}/export?format=pdf`), makeCtx(db), `${PRES_ID}/export`);
    expect(res.status).toBe(503);
  });
});

