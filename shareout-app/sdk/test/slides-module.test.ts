import { describe, expect, it } from 'vitest';
import { Presentation, SlidesStore } from '../src/stores/slides';
import type {
  CreatePresentationOptions,
  PresentationMeta,
  PresentationState,
  Slide,
} from '../src/stores/slides';

/**
 * Smoke tests that the decomposed slides module exports a stable public surface.
 * Behavioral coverage lives in presentation.test.ts and stores.test.ts.
 */
describe('Slides module structure', () => {
  it('exports SlidesStore and Presentation classes', () => {
    expect(SlidesStore).toBeTypeOf('function');
    expect(Presentation).toBeTypeOf('function');
  });

  it('exports presentation-related types for consumers', () => {
    const meta = {} as PresentationMeta;
    const slide = {} as Slide;
    const state = {} as PresentationState;
    const options = {} as CreatePresentationOptions;

    expect(meta).toBeDefined();
    expect(slide).toBeDefined();
    expect(state).toBeDefined();
    expect(options).toBeDefined();
  });
});
