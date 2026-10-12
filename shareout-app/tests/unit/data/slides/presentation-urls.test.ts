// @vitest-environment node
import './setup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/data/slides/realtime', () => ({
  broadcastEvent: vi.fn().mockResolvedValue(undefined),
}));

import * as middleware from '../../../../src/data/middleware';
import { handleSlides } from '../../../../src/data/slides/handler';
import {
  ARTIFACT_ID,
  BASE_URL,
  PRES_ID,
  createSlidesDb,
  jsonRequest,
  makeCtx,
  parseJson,
  seedPresentationWithSlides,
} from './shared';

describe('presentation URLs and host artifact ids', () => {
  beforeEach(() => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('create builds editor/published URLs from the artifact slug, not its name', async () => {
    const { db } = createSlidesDb();
    const res = await handleSlides(jsonRequest('POST', '', { title: 'Deck' }), makeCtx(db), '');
    expect(res.status).toBe(201);
    const data = (await parseJson(res)).data!;
    expect(data.editorUrl).toBe(`${BASE_URL}/a/demo-deck-slug`);
    expect(data.publishedUrl).toBe(`${BASE_URL}/p/demo-deck-slug`);
    expect(data.editorArtifactId).toBe(ARTIFACT_ID);
    expect(data.publishedArtifactId).toBe(ARTIFACT_ID);
  });

  it('get returns slug URLs and host artifact ids', async () => {
    const { db } = seedPresentationWithSlides();
    const res = await handleSlides(new Request('https://x'), makeCtx(db), PRES_ID);
    const data = (await parseJson(res)).data!;
    expect(data.editorUrl).toBe(`${BASE_URL}/a/demo-deck-slug`);
    expect(data.editorArtifactId).toBe(ARTIFACT_ID);
    expect(data.publishedArtifactId).toBe(ARTIFACT_ID);
  });

  it('list items carry slideCount and slug URLs', async () => {
    const { db } = seedPresentationWithSlides();
    const res = await handleSlides(new Request('https://x'), makeCtx(db), '');
    const [item] = (await parseJson(res)).data!.presentations as Record<string, unknown>[];
    expect(item.slideCount).toBe(2);
    expect(item.editorUrl).toBe(`${BASE_URL}/a/demo-deck-slug`);
    expect(item.publishedUrl).toBe(`${BASE_URL}/p/demo-deck-slug`);
  });

  it('publish status uses the slug URL', async () => {
    const { db } = seedPresentationWithSlides();
    const res = await handleSlides(new Request('https://x'), makeCtx(db), `${PRES_ID}/publish/status`);
    const data = (await parseJson(res)).data!;
    expect(data.publishedUrl).toBe(`${BASE_URL}/p/demo-deck-slug`);
    expect(data.publishedArtifactId).toBe(ARTIFACT_ID);
  });
});
