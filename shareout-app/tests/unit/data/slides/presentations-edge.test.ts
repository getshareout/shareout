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


describe('presentations edge cases', () => {
  beforeEach(() => {
    idSeq = 0;
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates presentation with defaults when body is invalid JSON', async () => {
    const { db, store } = createSlidesDb();
    const ctx = makeCtx(db);
    const req = new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/slides/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await handleSlides(req, ctx, '');
    const body = await parseJson(res);
    expect(res.status).toBe(201);
    expect(body.data?.title).toBe('Untitled Presentation');
    expect(store.slides).toHaveLength(1);
  });

  it('updates all presentation metadata fields', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('PATCH', PRES_ID, {
        title: 'Full Update',
        description: 'Desc',
        width: 1280,
        height: 720,
        aspectRatio: '4:3',
        template: 'minimal',
        defaultFonts: { heading: 'Georgia', body: 'Arial', mono: 'Courier' },
        defaultColors: { background: '#111', text: '#eee', accent: '#f00' },
        defaultTransition: { type: 'fade', duration: 250 },
      }),
      ctx,
      PRES_ID
    );
    const body = await parseJson(res);
    expect(res.status).toBe(200);
    expect(body.data?.title).toBe('Full Update');
    expect(store.presentations[0].width).toBe(1280);
    expect(store.presentations[0].aspect_ratio).toBe('4:3');
    expect(store.presentations[0].template).toBe('minimal');
  });

  it('rejects update with invalid JSON', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const req = new Request('https://x', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    });
    const res = await handleSlides(req, ctx, PRES_ID);
    expect(res.status).toBe(400);
  });

  it('forbids update and delete for non-owners', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    const patch = await handleSlides(jsonRequest('PATCH', PRES_ID, { title: 'Nope' }), ctx, PRES_ID);
    expect(patch.status).toBe(403);

    const del = await handleSlides(new Request('https://x', { method: 'DELETE' }), ctx, PRES_ID);
    expect(del.status).toBe(403);
  });

  it('returns 404 when updating or deleting missing presentation', async () => {
    const { db } = createSlidesDb();
    const ctx = makeCtx(db);

    const patch = await handleSlides(jsonRequest('PATCH', PRES_ID, { title: 'X' }), ctx, PRES_ID);
    expect(patch.status).toBe(404);

    const del = await handleSlides(new Request('https://x', { method: 'DELETE' }), ctx, PRES_ID);
    expect(del.status).toBe(404);
  });
});

