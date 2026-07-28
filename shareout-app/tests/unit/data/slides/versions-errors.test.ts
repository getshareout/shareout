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


describe('versions error paths', () => {
  beforeEach(() => {
    idSeq = 0;
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects unsupported methods on version routes', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    const root = await handleSlides(new Request('https://x', { method: 'DELETE' }), ctx, `${PRES_ID}/versions`);
    expect(root.status).toBe(405);

    const invalidId = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/versions/not-a-version`
    );
    expect(invalidId.status).toBe(400);

    const version = await handleSlides(
      new Request('https://x', { method: 'POST' }),
      ctx,
      `${PRES_ID}/versions/${VER_ID}`
    );
    expect(version.status).toBe(405);

    const diff = await handleSlides(
      new Request('https://x', { method: 'POST' }),
      ctx,
      `${PRES_ID}/versions/diff`
    );
    expect(diff.status).toBe(405);
  });

  it('forbids version create/restore for non-editors', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);

    const create = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/versions`, { name: 'blocked' }),
      ctx,
      `${PRES_ID}/versions`
    );
    expect(create.status).toBe(403);

    const restore = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/versions/${VER_ID}/restore`),
      ctx,
      `${PRES_ID}/versions/${VER_ID}/restore`
    );
    expect(restore.status).toBe(403);
  });

  it('rejects createVersion with invalid JSON', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const req = new Request('https://x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    });
    const res = await handleSlides(req, ctx, `${PRES_ID}/versions`);
    expect(res.status).toBe(400);
  });

  it('returns limit exceeded when no auto-save versions can be evicted', async () => {
    const pres = makePresentation({ id: PRES_ID });
    const versions: StoredVersion[] = Array.from({ length: MAX_VERSIONS_PER_PRESENTATION }, (_, i) => ({
      id: `ver_${(i + 1).toString(16).padStart(24, '0')}`,
      presentation_id: PRES_ID,
      name: `manual-${i}`,
      description: null,
      snapshot: '[]',
      slide_count: 0,
      created_by_id: null,
      created_by_name: null,
      is_auto_save: 0,
      created_at: new Date(Date.UTC(2026, 4, 30, 0, i)).toISOString(),
    }));
    const { db } = createSlidesDb({ presentations: [pres], slides: [makeSlide({ presentation_id: PRES_ID })], versions });
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/versions`, { name: 'One too many' }),
      ctx,
      `${PRES_ID}/versions`
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('returns 404 for missing versions', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const missingId = 'ver_' + '9'.repeat(24);

    const get = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/versions/${missingId}`
    );
    expect(get.status).toBe(404);

    const restore = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/versions/${missingId}/restore`),
      ctx,
      `${PRES_ID}/versions/${missingId}/restore`
    );
    expect(restore.status).toBe(404);

    const del = await handleSlides(
      new Request('https://x', { method: 'DELETE' }),
      ctx,
      `${PRES_ID}/versions/${missingId}`
    );
    expect(del.status).toBe(404);
  });

  it('forbids version delete for non-owners', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const { db } = createSlidesDb({
      presentations: [makePresentation({ id: PRES_ID })],
      versions: [{
        id: VER_ID,
        presentation_id: PRES_ID,
        name: 'v1',
        description: null,
        snapshot: '[]',
        slide_count: 0,
        created_by_id: null,
        created_by_name: null,
        is_auto_save: 0,
        created_at: '2026-05-30T12:00:00.000Z',
      }],
    });
    const ctx = makeCtx(db);
    const res = await handleSlides(
      new Request('https://x', { method: 'DELETE' }),
      ctx,
      `${PRES_ID}/versions/${VER_ID}`
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when diff references missing versions', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const fromId = 'ver_' + '1'.repeat(24);
    const toId = 'ver_' + '2'.repeat(24);

    const missingFrom = await handleSlides(
      new Request(`https://x?from=${fromId}&to=${toId}`, { method: 'GET' }),
      ctx,
      `${PRES_ID}/versions/diff`
    );
    expect(missingFrom.status).toBe(404);

    db.prepare('INSERT INTO presentation_versions')
      .bind(fromId, PRES_ID, 'from', null, '[]', 0, null, null, 0)
      .run();
    const missingTo = await handleSlides(
      new Request(`https://x?from=${fromId}&to=${toId}`, { method: 'GET' }),
      ctx,
      `${PRES_ID}/versions/diff`
    );
    expect(missingTo.status).toBe(404);
  });

  it('rejects restore with wrong HTTP method', async () => {
    const { db } = createSlidesDb({
      presentations: [makePresentation({ id: PRES_ID })],
      versions: [{
        id: VER_ID,
        presentation_id: PRES_ID,
        name: 'v1',
        description: null,
        snapshot: '[]',
        slide_count: 0,
        created_by_id: null,
        created_by_name: null,
        is_auto_save: 0,
        created_at: '2026-05-30T12:00:00.000Z',
      }],
    });
    const ctx = makeCtx(db);
    const res = await handleSlides(
      new Request('https://x', { method: 'GET' }),
      ctx,
      `${PRES_ID}/versions/${VER_ID}/restore`
    );
    expect(res.status).toBe(405);
  });
});

