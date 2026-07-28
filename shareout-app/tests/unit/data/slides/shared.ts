// @vitest-environment node
/**
 * Shared fixtures and request helpers for slides handler unit tests.
 * @module tests/unit/data/slides/shared
 */
import type { DataContext } from '../../../../src/data/middleware';
import { vi } from 'vitest';
import type { Env } from '../../../../src/types';
import {
  createSlidesDb,
  makePresentation,
  makeSlide,
  type StoredVersion,
} from '../slides-mock-db';
import {
  MAX_CONTENT_LENGTH,
  MAX_SLIDES_PER_PRESENTATION,
  MAX_VERSIONS_PER_PRESENTATION,
} from '../../../../src/data/slides/constants';

export {
  createSlidesDb,
  makePresentation,
  makeSlide,
  type StoredVersion,
  MAX_CONTENT_LENGTH,
  MAX_SLIDES_PER_PRESENTATION,
  MAX_VERSIONS_PER_PRESENTATION,
};

export const ARTIFACT_ID = 'art_test';
export const PRES_ID = 'pres_' + 'a'.repeat(24);
export const SLIDE_ID_1 = 'slide_' + 'b'.repeat(24);
export const SLIDE_ID_2 = 'slide_' + 'c'.repeat(24);
export const VER_ID = 'ver_' + 'd'.repeat(24);
export const BASE_URL = 'https://shareout.example.com';

export function makeCtx(db: ReturnType<typeof createSlidesDb>['db']): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    artifact: {
      id: ARTIFACT_ID,
      name: 'demo-deck',
      visibility: 'private',
      auth_method: null,
    },
    env: {
      DB: db as unknown as Env['DB'],
      SHAREOUT_BASE_URL: BASE_URL,
      REALTIME: {
        idFromName: vi.fn(),
        get: vi.fn(),
      },
    } as Env,
    origin: 'https://app.example.com',
  };
}

export function jsonRequest(method: string, path: string, body?: unknown): Request {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/slides/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function parseJson(res: Response) {
  return res.json() as Promise<{ success: boolean; data?: Record<string, unknown>; code?: string; error?: string }>;
}

export function seedPresentationWithSlides() {
  const pres = makePresentation({ id: PRES_ID, artifact_id: ARTIFACT_ID });
  const slide1 = makeSlide({ id: SLIDE_ID_1, presentation_id: PRES_ID, position: 0, content: 'Slide 1' });
  const slide2 = makeSlide({ id: SLIDE_ID_2, presentation_id: PRES_ID, position: 1, content: 'Slide 2' });
  return createSlidesDb({ presentations: [pres], slides: [slide1, slide2] });
}

