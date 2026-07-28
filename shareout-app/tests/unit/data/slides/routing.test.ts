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


describe('handleSlides routing', () => {
  beforeEach(() => {
    idSeq = 0;
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(broadcastEvent).mockClear();
  });

  it('lists presentations at root GET', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(new Request('https://x', { method: 'GET' }), ctx, '');
    const body = await parseJson(res);
    expect(res.status).toBe(200);
    expect(body.data?.count).toBe(1);
  });

  it('rejects invalid presentation IDs', async () => {
    const { db } = createSlidesDb();
    const ctx = makeCtx(db);
    const res = await handleSlides(new Request('https://x', { method: 'GET' }), ctx, 'bad-id/slides');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown sub-routes', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(new Request('https://x', { method: 'GET' }), ctx, `${PRES_ID}/unknown`);
    expect(res.status).toBe(404);
  });

  it('creates a presentation with default slide', async () => {
    const { db, store } = createSlidesDb();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', '', { title: 'New Deck' }),
      ctx,
      ''
    );
    const body = await parseJson(res);
    expect(res.status).toBe(201);
    expect(store.presentations).toHaveLength(1);
    expect(store.slides).toHaveLength(1);
    expect(body.data?.title).toBe('New Deck');
    expect(body.data?.editorUrl).toContain('/a/demo-deck');
  });

  it('forbids non-owners from creating presentations', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const { db } = createSlidesDb();
    const ctx = makeCtx(db);
    const res = await handleSlides(jsonRequest('POST', ''), ctx, '');
    expect(res.status).toBe(403);
  });

  it('gets a presentation with slides', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(new Request('https://x', { method: 'GET' }), ctx, PRES_ID);
    const body = await parseJson(res);
    expect(res.status).toBe(200);
    expect((body.data?.slides as unknown[]).length).toBe(2);
  });

  it('returns 404 when presentation missing', async () => {
    const { db } = createSlidesDb();
    const ctx = makeCtx(db);
    const res = await handleSlides(new Request('https://x', { method: 'GET' }), ctx, PRES_ID);
    expect(res.status).toBe(404);
  });

  it('updates presentation metadata', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('PATCH', PRES_ID, { title: 'Renamed', visibility: 'public' }),
      ctx,
      PRES_ID
    );
    const body = await parseJson(res);
    expect(res.status).toBe(200);
    expect(body.data?.title).toBe('Renamed');
    expect(store.presentations[0].visibility).toBe('public');
    expect(broadcastEvent).toHaveBeenCalled();
  });

  it('rejects invalid visibility on update', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('PATCH', PRES_ID, { visibility: 'secret' }),
      ctx,
      PRES_ID
    );
    expect(res.status).toBe(400);
  });

  it('rejects empty PATCH body', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(jsonRequest('PATCH', PRES_ID, {}), ctx, PRES_ID);
    expect(res.status).toBe(400);
  });

  it('deletes a presentation', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(new Request('https://x', { method: 'DELETE' }), ctx, PRES_ID);
    expect(res.status).toBe(200);
    expect(store.presentations).toHaveLength(0);
  });
});

