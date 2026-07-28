// @vitest-environment node
import { describe, expect, it } from 'vitest';
import distillSrc from '../../../src/knowledge/distill.ts?raw';
import consolidateSrc from '../../../src/knowledge/consolidate.ts?raw';

/**
 * The Knowledge lens localizes the generated overview by splitting on two deterministic
 * code-gen literals (work/041 §E). These pins fail CI if the server wording drifts, so a
 * server change breaks here instead of silently un-localizing the client. The client regex
 * lives in home-views/knowledge.ts (knOverviewChrome); keep it in sync with the assertion below.
 */
describe('knowledge overview code-gen literals', () => {
  it('regenerateIndex + regenerateOverview both emit the "## Top topics" split marker', () => {
    expect(distillSrc).toContain('## Top topics');
    expect(consolidateSrc).toContain('## Top topics');
  });

  it('bootstrap index emits a "N pages learned. Updated YYYY-MM-DD." line the client regex matches', () => {
    // The literal the server builds: `${digests.length} pages learned. Updated ${date}.`
    expect(distillSrc).toContain('pages learned. Updated ');
    const sample = `12 pages learned. Updated ${new Date().toISOString().slice(0, 10)}.`;
    expect(/^\d+ pages learned\. Updated \d{4}-\d{2}-\d{2}\.$/.test(sample)).toBe(true);
  });
});
