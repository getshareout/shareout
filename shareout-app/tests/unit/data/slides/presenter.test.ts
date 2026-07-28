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


describe('presenter routes', () => {
  beforeEach(() => {
    idSeq = 0;
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts and stops presenting', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    const startRes = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/start`, { fromSlide: 1, countdown: 300 }),
      ctx,
      `${PRES_ID}/presenter/start`
    );
    expect(startRes.status).toBe(200);
    expect(store.states[0].is_presenting).toBe(1);
    expect(store.states[0].current_slide_index).toBe(1);

    const stopRes = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/stop`),
      ctx,
      `${PRES_ID}/presenter/stop`
    );
    expect(stopRes.status).toBe(200);
    expect(store.states[0].is_presenting).toBe(0);
  });

  it('returns default presenter state when not started', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/presenter/state`
    );
    const body = await parseJson(res);
    expect(body.data?.isPresenting).toBe(false);
    expect(body.data?.totalSlides).toBe(2);
  });

  it('navigates slides as presenter', async () => {
    const { db, store } = seedPresentationWithSlides();
    store.states.push({
      presentation_id: PRES_ID,
      is_presenting: 1,
      presenter_id: 'usr_1',
      presenter_name: 'Presenter',
      current_slide_index: 0,
      started_at: '2026-05-30T12:00:00.000Z',
      slide_started_at: '2026-05-30T12:00:00.000Z',
      countdown_total: null,
      countdown_remaining: null,
      countdown_paused: 0,
      laser_enabled: 0,
      laser_x: null,
      laser_y: null,
      updated_at: '2026-05-30T12:00:00.000Z',
    });
    const ctx = makeCtx(db);
    const authModule = await import('../../../../src/data/slides/auth');
    vi.spyOn(authModule, 'getSession').mockResolvedValue({ userId: 'usr_1', email: 'p@example.com', name: 'Presenter' });
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);

    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/navigate`, { slideIndex: 1 }),
      ctx,
      `${PRES_ID}/presenter/navigate`
    );
    expect(res.status).toBe(200);
    expect(store.states[0].current_slide_index).toBe(1);
  });

  it('controls presenter timer actions', async () => {
    const { db, store } = seedPresentationWithSlides();
    store.states.push({
      presentation_id: PRES_ID,
      is_presenting: 1,
      presenter_id: 'usr_1',
      presenter_name: 'Presenter',
      current_slide_index: 0,
      started_at: '2026-05-30T12:00:00.000Z',
      slide_started_at: '2026-05-30T12:00:00.000Z',
      countdown_total: 60,
      countdown_remaining: 60,
      countdown_paused: 0,
      laser_enabled: 0,
      laser_x: null,
      laser_y: null,
      updated_at: '2026-05-30T12:00:00.000Z',
    });
    const ctx = makeCtx(db);

    for (const action of [
      { action: 'setCountdown', seconds: 120 },
      { action: 'pause' },
      { action: 'resume' },
      { action: 'reset' },
    ] as const) {
      const res = await handleSlides(
        jsonRequest('POST', `${PRES_ID}/presenter/timer`, action),
        ctx,
        `${PRES_ID}/presenter/timer`
      );
      expect(res.status).toBe(200);
    }

    expect(store.states[0].countdown_total).toBe(120);
  });

  it('controls laser pointer', async () => {
    const { db, store } = seedPresentationWithSlides();
    store.states.push({
      presentation_id: PRES_ID,
      is_presenting: 1,
      presenter_id: 'usr_1',
      presenter_name: 'Presenter',
      current_slide_index: 0,
      started_at: '2026-05-30T12:00:00.000Z',
      slide_started_at: '2026-05-30T12:00:00.000Z',
      countdown_total: null,
      countdown_remaining: null,
      countdown_paused: 0,
      laser_enabled: 0,
      laser_x: null,
      laser_y: null,
      updated_at: '2026-05-30T12:00:00.000Z',
    });
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/laser`, { enabled: true, x: 0.5, y: 0.5 }),
      ctx,
      `${PRES_ID}/presenter/laser`
    );
    expect(res.status).toBe(200);
    expect(store.states[0].laser_enabled).toBe(1);
  });

  it('returns 404 for unknown presenter action', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(new Request('https://x', { method: 'GET' }), ctx, `${PRES_ID}/presenter/unknown`);
    expect(res.status).toBe(404);
  });
});

