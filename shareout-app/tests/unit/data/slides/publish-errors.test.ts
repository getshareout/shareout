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


describe('publish error paths', () => {
  beforeEach(() => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 404 for publish status on missing presentation', async () => {
    const { db } = createSlidesDb();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/publish/status`
    );
    expect(res.status).toBe(404);
  });

  it('rejects invalid visibility requests', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    const wrongMethod = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/publish/visibility`
    );
    expect(wrongMethod.status).toBe(405);

    const badJson = new Request('https://x', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    });
    expect((await handleSlides(badJson, ctx, `${PRES_ID}/publish/visibility`)).status).toBe(400);

    const invalid = await handleSlides(
      jsonRequest('PUT', `${PRES_ID}/publish/visibility`, { visibility: 'secret' }),
      ctx,
      `${PRES_ID}/publish/visibility`
    );
    expect(invalid.status).toBe(400);
  });

  it('guards unpublish and republish', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    const unpublishMethod = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/publish/unpublish`
    );
    expect(unpublishMethod.status).toBe(405);

    const republishMethod = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/publish/republish`
    );
    expect(republishMethod.status).toBe(405);

    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const unpublishForbidden = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/publish/unpublish`),
      ctx,
      `${PRES_ID}/publish/unpublish`
    );
    expect(unpublishForbidden.status).toBe(403);

    const republishForbidden = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/publish/republish`),
      ctx,
      `${PRES_ID}/publish/republish`
    );
    expect(republishForbidden.status).toBe(403);
  });

  it('returns 404 for unknown publish action', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/publish/unknown`
    );
    expect(res.status).toBe(404);
  });
});

