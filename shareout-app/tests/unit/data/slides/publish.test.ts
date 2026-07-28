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


describe('publish routes', () => {
  beforeEach(() => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns publish status', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/publish/status`
    );
    const body = await parseJson(res);
    expect(body.data?.visibility).toBe('private');
    expect(body.data?.publishedUrl).toContain('/p/demo-deck');
  });

  it('changes visibility', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('PUT', `${PRES_ID}/publish/visibility`, { visibility: 'public' }),
      ctx,
      `${PRES_ID}/publish/visibility`
    );
    expect(res.status).toBe(200);
    expect(store.presentations[0].visibility).toBe('public');
  });

  it('unpublishes and republishes', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    const unpublish = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/publish/unpublish`),
      ctx,
      `${PRES_ID}/publish/unpublish`
    );
    expect(unpublish.status).toBe(200);
    expect(store.presentations[0].visibility).toBe('private');

    const republish = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/publish/republish`),
      ctx,
      `${PRES_ID}/publish/republish`
    );
    expect(republish.status).toBe(200);
    expect(store.presentations[0].visibility).toBe('public');
  });

  it('forbids visibility change for non-owners', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('PUT', `${PRES_ID}/publish/visibility`, { visibility: 'public' }),
      ctx,
      `${PRES_ID}/publish/visibility`
    );
    expect(res.status).toBe(403);
  });
});

