import { describe, it, expect } from 'vitest';
import { buildModelFromHtml } from '../../shared/editor-readiness/from-html';
import { evaluateReadiness } from '../../shared/editor-readiness/evaluate';
import { FIXTURES, serializeProfile } from '../../shared/editor-readiness/fixtures';

describe('editor-readiness — HTMLRewriter adapter (worker)', () => {
  for (const fixture of FIXTURES) {
    it(`matches the golden profile: ${fixture.name}`, async () => {
      const profile = evaluateReadiness(await buildModelFromHtml(fixture.html));
      expect(serializeProfile(profile)).toEqual(fixture.expected);
    });
  }
});
