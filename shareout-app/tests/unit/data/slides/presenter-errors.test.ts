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


describe('presenter error paths', () => {
  beforeEach(() => {
    idSeq = 0;
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function seedPresentingState(presenterId = 'usr_1') {
    const seeded = seedPresentationWithSlides();
    seeded.store.states.push({
      presentation_id: PRES_ID,
      is_presenting: 1,
      presenter_id: presenterId,
      presenter_name: 'Presenter',
      current_slide_index: 0,
      started_at: '2026-05-30T12:00:00.000Z',
      slide_started_at: '2026-05-30T12:00:00.000Z',
      countdown_total: 90,
      countdown_remaining: 45,
      countdown_paused: 0,
      laser_enabled: 1,
      laser_x: 0.25,
      laser_y: 0.75,
      updated_at: '2026-05-30T12:00:00.000Z',
    });
    return seeded;
  }

  it('rejects wrong HTTP methods on presenter actions', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    for (const path of ['start', 'stop', 'navigate', 'timer', 'laser']) {
      const res = await handleSlides(new Request('https://x', { method: 'GET' }), ctx, `${PRES_ID}/presenter/${path}`);
      expect(res.status).toBe(405);
    }
  });

  it('starts with defaults when body is invalid JSON', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const req = new Request('https://x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    });
    const res = await handleSlides(req, ctx, `${PRES_ID}/presenter/start`);
    expect(res.status).toBe(200);
    expect(store.states[0].current_slide_index).toBe(0);
  });

  it('returns full presenter state including countdown and laser', async () => {
    const { db } = seedPresentingState();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/presenter/state`
    );
    const body = await parseJson(res);
    expect(body.data?.countdown).toEqual({ total: 90, remaining: 45, paused: false });
    expect(body.data?.laser).toEqual({ enabled: true, position: { x: 0.25, y: 0.75 } });
  });

  it('validates navigate requests', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    const badJson = new Request('https://x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    });
    expect((await handleSlides(badJson, ctx, `${PRES_ID}/presenter/navigate`)).status).toBe(400);

    const missingIndex = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/navigate`, {}),
      ctx,
      `${PRES_ID}/presenter/navigate`
    );
    expect(missingIndex.status).toBe(400);

    const notStarted = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/navigate`, { slideIndex: 0 }),
      ctx,
      `${PRES_ID}/presenter/navigate`
    );
    expect(notStarted.status).toBe(400);
  });

  it('forbids navigate/timer/laser for non-presenters', async () => {
    const { db } = seedPresentingState('usr_presenter');
    const ctx = makeCtx(db);
    const authModule = await import('../../../../src/data/slides/auth');
    vi.spyOn(authModule, 'getSession').mockResolvedValue({ userId: 'usr_other', email: 'other@example.com' });
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);

    const navigate = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/navigate`, { slideIndex: 1 }),
      ctx,
      `${PRES_ID}/presenter/navigate`
    );
    expect(navigate.status).toBe(403);

    const timer = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/timer`, { action: 'pause' }),
      ctx,
      `${PRES_ID}/presenter/timer`
    );
    expect(timer.status).toBe(403);

    const laser = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/laser`, { enabled: true }),
      ctx,
      `${PRES_ID}/presenter/laser`
    );
    expect(laser.status).toBe(403);
  });

  it('validates timer and laser requests', async () => {
    const notStarted = seedPresentationWithSlides();
    const ctxNotStarted = makeCtx(notStarted.db);

    const timerNotStarted = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/timer`, { action: 'pause' }),
      ctxNotStarted,
      `${PRES_ID}/presenter/timer`
    );
    expect(timerNotStarted.status).toBe(400);

    const laserNotStarted = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/laser`, { enabled: true }),
      ctxNotStarted,
      `${PRES_ID}/presenter/laser`
    );
    expect(laserNotStarted.status).toBe(400);

    const presenting = seedPresentingState();
    const ctx = makeCtx(presenting.db);

    const timerBadJson = new Request('https://x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    });
    expect((await handleSlides(timerBadJson, ctx, `${PRES_ID}/presenter/timer`)).status).toBe(400);

    const invalidSeconds = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/timer`, { action: 'setCountdown', seconds: -5 }),
      ctx,
      `${PRES_ID}/presenter/timer`
    );
    expect(invalidSeconds.status).toBe(400);

    const invalidAction = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/presenter/timer`, { action: 'bogus' }),
      ctx,
      `${PRES_ID}/presenter/timer`
    );
    expect(invalidAction.status).toBe(400);

    const laserBadJson = new Request('https://x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    });
    expect((await handleSlides(laserBadJson, ctx, `${PRES_ID}/presenter/laser`)).status).toBe(400);
  });
});

