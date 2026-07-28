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


describe('version routes', () => {
  beforeEach(() => {
    idSeq = 0;
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists versions', async () => {
    const { db } = seedPresentationWithSlides();
    const version: StoredVersion = {
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
    };
    db.prepare('INSERT INTO presentation_versions')
      .bind(VER_ID, PRES_ID, 'v1', null, '[]', 0, null, null, 0)
      .run();
    const ctx = makeCtx(db);
    const res = await handleSlides(new Request('https://x', { method: 'GET' }), ctx, `${PRES_ID}/versions`);
    const body = await parseJson(res);
    expect(body.data?.count).toBe(1);
  });

  it('creates a version snapshot', async () => {
    const { db, store } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/versions`, { name: 'Checkpoint', description: 'Before edits' }),
      ctx,
      `${PRES_ID}/versions`
    );
    expect(res.status).toBe(201);
    expect(store.versions).toHaveLength(1);
    expect(store.versions[0].slide_count).toBe(2);
  });

  it('requires version name', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(jsonRequest('POST', `${PRES_ID}/versions`, {}), ctx, `${PRES_ID}/versions`);
    expect(res.status).toBe(400);
  });

  it('gets a version with snapshot', async () => {
    const snapshot = JSON.stringify([{ id: SLIDE_ID_1, content: 'A', position: 0 }]);
    const { db } = createSlidesDb({
      presentations: [makePresentation({ id: PRES_ID })],
      versions: [{
        id: VER_ID,
        presentation_id: PRES_ID,
        name: 'v1',
        description: null,
        snapshot,
        slide_count: 1,
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
      `${PRES_ID}/versions/${VER_ID}`
    );
    const body = await parseJson(res);
    expect((body.data?.snapshot as unknown[]).length).toBe(1);
  });

  it('restores a version', async () => {
    const snapshot = JSON.stringify([
      {
        id: SLIDE_ID_1,
        presentationId: PRES_ID,
        position: 0,
        ownerId: null,
        overrideBackground: null,
        overrideFonts: null,
        overrideTransition: null,
        content: 'Restored',
        hidden: false,
        locked: false,
        notes: 'note text',
      },
    ]);
    const { db, store } = createSlidesDb({
      presentations: [makePresentation({ id: PRES_ID })],
      slides: [makeSlide({ id: SLIDE_ID_1, presentation_id: PRES_ID })],
      versions: [{
        id: VER_ID,
        presentation_id: PRES_ID,
        name: 'v1',
        description: null,
        snapshot,
        slide_count: 1,
        created_by_id: null,
        created_by_name: null,
        is_auto_save: 0,
        created_at: '2026-05-30T12:00:00.000Z',
      }],
    });
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/versions/${VER_ID}/restore`),
      ctx,
      `${PRES_ID}/versions/${VER_ID}/restore`
    );
    expect(res.status).toBe(200);
    expect(store.slides).toHaveLength(1);
    expect(store.notes).toHaveLength(1);
  });

  it('deletes a version as owner', async () => {
    const { db, store } = createSlidesDb({
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
    expect(res.status).toBe(200);
    expect(store.versions).toHaveLength(0);
  });

  it('computes version diff', async () => {
    const fromSnapshot = JSON.stringify([
      { id: SLIDE_ID_1, content: 'A', position: 0 },
      { id: SLIDE_ID_2, content: 'B', position: 1 },
    ]);
    const toSnapshot = JSON.stringify([
      { id: SLIDE_ID_2, content: 'B changed', position: 0 },
      { id: 'slide_' + 'e'.repeat(24), content: 'C', position: 1 },
    ]);
    const { db } = createSlidesDb({
      presentations: [makePresentation({ id: PRES_ID })],
      versions: [
        {
          id: 'ver_' + '1'.repeat(24),
          presentation_id: PRES_ID,
          name: 'from',
          description: null,
          snapshot: fromSnapshot,
          slide_count: 2,
          created_by_id: null,
          created_by_name: null,
          is_auto_save: 0,
          created_at: '2026-05-30T11:00:00.000Z',
        },
        {
          id: 'ver_' + '2'.repeat(24),
          presentation_id: PRES_ID,
          name: 'to',
          description: null,
          snapshot: toSnapshot,
          slide_count: 2,
          created_by_id: null,
          created_by_name: null,
          is_auto_save: 0,
          created_at: '2026-05-30T12:00:00.000Z',
        },
      ],
    });
    const ctx = makeCtx(db);
    const fromId = 'ver_' + '1'.repeat(24);
    const toId = 'ver_' + '2'.repeat(24);
    const url = `https://x?from=${fromId}&to=${toId}`;
    const res = await handleSlides(new Request(url, { method: 'GET' }), ctx, `${PRES_ID}/versions/diff`);
    const body = await parseJson(res);
    const slides = body.data?.slides as { added: string[]; removed: string[]; modified: string[]; reordered: boolean };
    expect(slides.added.length).toBeGreaterThan(0);
    expect(slides.removed).toContain(SLIDE_ID_1);
    expect(slides.modified).toContain(SLIDE_ID_2);
    expect(slides.reordered).toBe(true);
  });

  it('rejects diff without from/to params', async () => {
    const { db } = seedPresentationWithSlides();
    const ctx = makeCtx(db);
    const res = await handleSlides(new Request('https://x', { method: 'GET' }), ctx, `${PRES_ID}/versions/diff`);
    expect(res.status).toBe(400);
  });

  it('evicts oldest auto-save when version limit reached', async () => {
    const pres = makePresentation({ id: PRES_ID });
    const versions: StoredVersion[] = Array.from({ length: MAX_VERSIONS_PER_PRESENTATION }, (_, i) => ({
      id: `ver_${(i + 1).toString(16).padStart(24, '0')}`,
      presentation_id: PRES_ID,
      name: `auto-${i}`,
      description: null,
      snapshot: '[]',
      slide_count: 0,
      created_by_id: null,
      created_by_name: null,
      is_auto_save: 1,
      created_at: new Date(Date.UTC(2026, 4, 30, 0, i)).toISOString(),
    }));
    const { db, store } = createSlidesDb({ presentations: [pres], slides: [makeSlide({ presentation_id: PRES_ID })], versions });
    const ctx = makeCtx(db);
    const res = await handleSlides(
      jsonRequest('POST', `${PRES_ID}/versions`, { name: 'New autosave', isAutoSave: true }),
      ctx,
      `${PRES_ID}/versions`
    );
    expect(res.status).toBe(201);
    expect(store.versions.length).toBe(10);
    expect(store.versions.every((v) => v.is_auto_save === 1)).toBe(true);
  });
});

