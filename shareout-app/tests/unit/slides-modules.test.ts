// @vitest-environment node
/**
 * Structural guard for the slides test decomposition (2026-07-18).
 * Ensures the monolithic slides.test.ts stays split into focused modules.
 */
import { describe, expect, it } from 'vitest';

const slideTests = import.meta.glob('./data/slides/*.test.ts');
const slideSupport = import.meta.glob('./data/slides/{shared,setup,index}.ts', { eager: true });

const EXPECTED_SUITES = [
  'ai-actions.test.ts',
  'auth.test.ts',
  'db-mappers.test.ts',
  'export.test.ts',
  'generate.test.ts',
  'presentations-edge.test.ts',
  'presenter-errors.test.ts',
  'presenter.test.ts',
  'publish-errors.test.ts',
  'publish.test.ts',
  'routing.test.ts',
  'slide-crud.test.ts',
  'slides-errors.test.ts',
  'versions-errors.test.ts',
  'versions.test.ts',
].sort();

describe('slides test module layout', () => {
  it('loads 15 focused test modules (no monolithic slides.test.ts)', () => {
    const names = Object.keys(slideTests).map((p) => p.split('/').pop()!).sort();
    expect(names).toEqual(EXPECTED_SUITES);
    expect(names).not.toContain('slides.test.ts');
  });

  it('includes shared setup and barrel modules', () => {
    expect(Object.keys(slideSupport)).toEqual(
      expect.arrayContaining([
        './data/slides/shared.ts',
        './data/slides/setup.ts',
        './data/slides/index.ts',
      ]),
    );
  });

  it('exports shared fixtures from shared.ts', async () => {
    const shared = await import('./data/slides/shared');
    expect(shared.ARTIFACT_ID).toBe('art_test');
    expect(typeof shared.makeCtx).toBe('function');
    expect(typeof shared.seedPresentationWithSlides).toBe('function');
  });
});
