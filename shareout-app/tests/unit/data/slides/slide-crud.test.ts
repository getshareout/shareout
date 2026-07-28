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


describe('slide CRUD routes', () => {
  beforeEach(() => {
    idSeq = 0;
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists slides for a presentation', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(new Request('https://x', { method: 'GET' }), ctx, `${PRES_ID}/slides`);
    const body = await parseJson(res);
    expect(body.data?.count).toBe(2);
  });

  it('returns 404 when listing slides for missing presentation', async () => {
    const { db } = createSlidesDb();
    const ctx = makeCtx(db);
    const res = await handleSlides(new Request('https://x', { method: 'GET' }), ctx, `${PRES_ID}/slides`);
    expect(res.status).toBe(404);
  });

  it('adds a slide at end by default', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides`, { content: 'New slide' }),
      ctx,
      `${PRES_ID}/slides`
    );
    expect(res.status).toBe(201);
    expect(store.slides).toHaveLength(3);
    const added = store.slides.find((s) => s.content === 'New slide');
    expect(added?.position).toBe(2);
  });

  it('inserts slide after a specific slide', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides`, { afterSlideId: SLIDE_ID_1, content: 'Inserted' }),
      ctx,
      `${PRES_ID}/slides`
    );
    expect(res.status).toBe(201);
    const inserted = store.slides.find((s) => s.content === 'Inserted');
    expect(inserted?.position).toBe(1);
  });

  it('forbids adding slides without edit permission', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(jsonRequest('POST', `${PRES_ID}/slides`, {}), ctx, `${PRES_ID}/slides`);
    expect(res.status).toBe(403);
  });

  it('enforces slide count limit', async () => {
    const pres = makePresentation({ id: PRES_ID });
    const slides = Array.from({ length: MAX_SLIDES_PER_PRESENTATION }, (_, i) =>
      makeSlide({ id: `slide_${i.toString(16).padStart(24, '0')}`, presentation_id: PRES_ID, position: i })
    );
    const { db } = createSlidesDb({ presentations: [pres], slides });
    const ctx = makeCtx(db);
    const res = await handleSlides(jsonRequest('POST', `${PRES_ID}/slides`, {}), ctx, `${PRES_ID}/slides`);
    expect(res.status).toBe(400);
  });

  it('gets a single slide with notes', async () => {
    const { db } = seedPresentationWithSlides();
    db.prepare('INSERT INTO slide_notes').bind('note_1', SLIDE_ID_1, 'Speaker notes', 'now').run();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}`
    );
    const body = await parseJson(res);
    expect(body.data?.content).toBe('Slide 1');
  });

  it('returns 404 for missing slide', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const missingId = 'slide_' + 'f'.repeat(24);
    const res = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/slides/${missingId}`
    );
    expect(res.status).toBe(404);
  });

  it('rejects invalid slide IDs', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/slides/not-a-slide-id`
    );
    expect(res.status).toBe(400);
  });

  it('updates slide content and flags', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('PATCH', `${PRES_ID}/slides/${SLIDE_ID_1}`, {
        content: 'Updated',
        hidden: true,
        overrideBackground: '#111',
        overrideFonts: { heading: 'Roboto' },
        overrideTransition: { type: 'zoom', duration: 100 },
      }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}`
    );
    expect(res.status).toBe(200);
    const slide = store.slides.find((s) => s.id === SLIDE_ID_1)!;
    expect(slide.content).toBe('Updated');
    expect(slide.hidden).toBe(1);
  });

  it('rejects oversized content', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('PATCH', `${PRES_ID}/slides/${SLIDE_ID_1}`, { content: 'x'.repeat(MAX_CONTENT_LENGTH + 1) }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}`
    );
    expect(res.status).toBe(400);
  });

  it('rejects PATCH with invalid JSON', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const req = new Request('https://x', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await handleSlides(req, ctx, `${PRES_ID}/slides/${SLIDE_ID_1}`);
    expect(res.status).toBe(400);
  });

  it('deletes a slide and compacts positions', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      new Request('https://x', { method: 'DELETE' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}`
    );
    expect(res.status).toBe(200);
    expect(store.slides).toHaveLength(1);
    expect(store.slides[0].position).toBe(0);
  });

  it('prevents deleting the last slide', async () => {
    const pres = makePresentation({ id: PRES_ID });
    const only = makeSlide({ id: SLIDE_ID_1, presentation_id: PRES_ID, position: 0 });
    const { db } = createSlidesDb({ presentations: [pres], slides: [only] });
    const ctx = makeCtx(db);
    const res = await handleSlides(
      new Request('https://x', { method: 'DELETE' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}`
    );
    expect(res.status).toBe(400);
  });

  it('reorders slides via POST', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/reorder`, { slideIds: [SLIDE_ID_2, SLIDE_ID_1] }),
      ctx,
      `${PRES_ID}/slides/reorder`
    );
    expect(res.status).toBe(200);
    expect(store.slides.find((s) => s.id === SLIDE_ID_2)?.position).toBe(0);
    expect(store.slides.find((s) => s.id === SLIDE_ID_1)?.position).toBe(1);
  });

  it('rejects reorder without slideIds array', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/reorder`, { slideIds: 'nope' }),
      ctx,
      `${PRES_ID}/slides/reorder`
    );
    expect(res.status).toBe(400);
  });

  it('batch-appends slides at the end', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/batch`, {
        slides: [{ content: 'A' }, { content: 'B', hidden: true }],
      }),
      ctx,
      `${PRES_ID}/slides/batch`
    );
    expect(res.status).toBe(201);
    const body = await parseJson(res);
    expect(body.data?.created).toBe(2);
    expect(store.slides).toHaveLength(4);
    expect(store.slides.find((s) => s.content === 'A')?.position).toBe(2);
    expect(store.slides.find((s) => s.content === 'B')?.hidden).toBe(1);
  });

  it('batch-replaces all slides when replace=true', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/batch`, {
        slides: [{ content: 'Only', notes: 'hello' }],
        replace: true,
      }),
      ctx,
      `${PRES_ID}/slides/batch`
    );
    expect(res.status).toBe(201);
    expect(store.slides).toHaveLength(1);
    expect(store.slides[0].content).toBe('Only');
    expect(store.slides[0].position).toBe(0);
  });

  it('rejects batch without slides array', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/batch`, { slides: [] }),
      ctx,
      `${PRES_ID}/slides/batch`
    );
    expect(res.status).toBe(400);
  });

  it('enforces slide limit on batch append', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const slides = Array.from({ length: MAX_SLIDES_PER_PRESENTATION }, () => ({ content: 'x' }));
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/batch`, { slides }),
      ctx,
      `${PRES_ID}/slides/batch`
    );
    expect(res.status).toBe(400);
  });

  it('forbids batch without edit permission', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/batch`, { slides: [{ content: 'A' }] }),
      ctx,
      `${PRES_ID}/slides/batch`
    );
    expect(res.status).toBe(403);
  });

  it('duplicates a slide', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/${SLIDE_ID_1}/duplicate`),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/duplicate`
    );
    expect(res.status).toBe(201);
    expect(store.slides).toHaveLength(3);
  });

  it('locks and unlocks slides', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const lockRes = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/${SLIDE_ID_1}/lock`),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/lock`
    );
    expect(lockRes.status).toBe(200);
    expect(store.slides.find((s) => s.id === SLIDE_ID_1)?.locked).toBe(1);

    const unlockRes = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/${SLIDE_ID_1}/unlock`),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/unlock`
    );
    expect(unlockRes.status).toBe(200);
    expect(store.slides.find((s) => s.id === SLIDE_ID_1)?.locked).toBe(0);
  });

  it('forbids lock when not owner or slide owner', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const authModule = await import('../../../../src/data/slides/auth');
    vi.spyOn(authModule, 'getSession').mockResolvedValue({ userId: 'usr_other', email: 'x@y.com' });
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/${SLIDE_ID_1}/lock`),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/lock`
    );
    expect(res.status).toBe(403);
  });

  it('sets slide owner', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('PUT', `${PRES_ID}/slides/${SLIDE_ID_1}/owner`, { userId: 'usr_new' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/owner`
    );
    expect(res.status).toBe(200);
    expect(store.slides.find((s) => s.id === SLIDE_ID_1)?.owner_id).toBe('usr_new');
  });

  it('reads and writes slide notes', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    const getRes = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/notes`
    );
    const getBody = await parseJson(getRes);
    expect(getBody.data?.notes).toBe('');

    const putRes = await handleSlides(
      jsonRequest('PUT', `${PRES_ID}/slides/${SLIDE_ID_1}/notes`, { content: 'Remember to pause' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/notes`
    );
    expect(putRes.status).toBe(200);
  });
});

