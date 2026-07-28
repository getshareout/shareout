// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { buildModelFromDom } from '../../shared/editor-readiness/from-dom';
import { evaluateReadiness } from '../../shared/editor-readiness/evaluate';
import { FIXTURES, serializeProfile } from '../../shared/editor-readiness/fixtures';

// No-drift guarantee: the DOM adapter must produce the same serialized profile as the
// HTMLRewriter adapter (asserted against the identical goldens in test/editor-readiness.test.ts).
describe('editor-readiness — DOM adapter (editor) matches the shared goldens', () => {
  for (const fixture of FIXTURES) {
    it(`matches the golden profile: ${fixture.name}`, () => {
      const doc = new DOMParser().parseFromString(fixture.html, 'text/html');
      const profile = evaluateReadiness(buildModelFromDom(doc));
      expect(serializeProfile(profile)).toEqual(fixture.expected);
    });
  }
});
