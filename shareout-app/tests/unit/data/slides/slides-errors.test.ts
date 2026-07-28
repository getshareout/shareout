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


describe('slides error paths', () => {
  beforeEach(() => {
    idSeq = 0;
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects unsupported methods on slide routes', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    const list = await handleSlides(new Request('https://x', { method: 'DELETE' }), ctx, `${PRES_ID}/slides`);
    expect(list.status).toBe(405);

    const reorder = await handleSlides(new Request('https://x', { method: 'GET' }), ctx, `${PRES_ID}/slides/reorder`);
    expect(reorder.status).toBe(405);

    const duplicate = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/duplicate`
    );
    expect(duplicate.status).toBe(405);

    const lock = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/lock`
    );
    expect(lock.status).toBe(405);

    const owner = await handleSlides(
      new Request('https://x', { method: 'POST' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/owner`
    );
    expect(owner.status).toBe(405);
  });

  it('adds slide with defaults when body is invalid JSON', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const req = new Request('https://x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await handleSlides(req, ctx, `${PRES_ID}/slides`);
    expect(res.status).toBe(201);
    expect(store.slides).toHaveLength(3);
  });

  it('forbids slide mutations without edit permission', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const authModule = await import('../../../../src/data/slides/auth');
    vi.spyOn(authModule, 'getSession').mockResolvedValue({ userId: 'usr_other', email: 'x@y.com' });

    const lockedSlide = makeSlide({ id: SLIDE_ID_1, presentation_id: PRES_ID, locked: 1, owner_id: 'usr_owner' });
    const openSlide = makeSlide({ id: SLIDE_ID_2, presentation_id: PRES_ID, position: 1 });
    const { db } = createSlidesDb({
      presentations: [makePresentation({ id: PRES_ID, artifact_id: ARTIFACT_ID })],
      slides: [lockedSlide, openSlide],
    });
    const ctx = makeCtx(db);

    const patch = await handleSlides(
      jsonRequest('PATCH', `${PRES_ID}/slides/${SLIDE_ID_1}`, { content: 'blocked' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}`
    );
    expect(patch.status).toBe(403);

    const del = await handleSlides(
      new Request('https://x', { method: 'DELETE' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}`
    );
    expect(del.status).toBe(403);

    const reorder = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/reorder`, { slideIds: [SLIDE_ID_2, SLIDE_ID_1] }),
      ctx,
      `${PRES_ID}/slides/reorder`
    );
    expect(reorder.status).toBe(403);

    const duplicate = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/${SLIDE_ID_1}/duplicate`),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/duplicate`
    );
    expect(duplicate.status).toBe(403);
  });

  it('rejects PATCH with no valid fields', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('PATCH', `${PRES_ID}/slides/${SLIDE_ID_1}`, { unknownField: true }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}`
    );
    expect(res.status).toBe(400);
  });

  it('rejects reorder with invalid JSON', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const req = new Request('https://x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    });
    const res = await handleSlides(req, ctx, `${PRES_ID}/slides/reorder`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for duplicate on missing slide', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const missingId = 'slide_' + '9'.repeat(24);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/${missingId}/duplicate`),
      ctx,
      `${PRES_ID}/slides/${missingId}/duplicate`
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for lock/unlock on missing slide', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const missingId = 'slide_' + '8'.repeat(24);

    const lock = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/${missingId}/lock`),
      ctx,
      `${PRES_ID}/slides/${missingId}/lock`
    );
    expect(lock.status).toBe(404);

    const unlock = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/slides/${missingId}/unlock`),
      ctx,
      `${PRES_ID}/slides/${missingId}/unlock`
    );
    expect(unlock.status).toBe(404);
  });

  it('forbids setSlideOwner for non-owners and missing slides', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    const forbidden = await handleSlides(
      jsonRequest('PUT', `${PRES_ID}/slides/${SLIDE_ID_1}/owner`, { userId: 'usr_x' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/owner`
    );
    expect(forbidden.status).toBe(403);

    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    const missingId = 'slide_' + '7'.repeat(24);
    const notFound = await handleSlides(
      jsonRequest('PUT', `${PRES_ID}/slides/${missingId}/owner`, { userId: 'usr_x' }),
      ctx,
      `${PRES_ID}/slides/${missingId}/owner`
    );
    expect(notFound.status).toBe(404);
  });

  it('rejects invalid JSON for setSlideOwner', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const req = new Request('https://x', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    const res = await handleSlides(req, ctx, `${PRES_ID}/slides/${SLIDE_ID_1}/owner`);
    expect(res.status).toBe(400);
  });

  it('guards notes routes for forbidden edits and bad requests', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    const forbidden = await handleSlides(
      jsonRequest('PUT', `${PRES_ID}/slides/${SLIDE_ID_1}/notes`, { content: 'nope' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/notes`
    );
    expect(forbidden.status).toBe(403);

    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    const badJson = new Request('https://x', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    });
    const invalid = await handleSlides(badJson, ctx, `${PRES_ID}/slides/${SLIDE_ID_1}/notes`);
    expect(invalid.status).toBe(400);

    const method = await handleSlides(
      new Request('https://x', { method: 'DELETE' }),
      ctx,
      `${PRES_ID}/slides/${SLIDE_ID_1}/notes`
    );
    expect(method.status).toBe(405);
  });
});

