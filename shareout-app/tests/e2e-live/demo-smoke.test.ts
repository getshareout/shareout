import { describe, expect, it } from 'vitest';
import { baseUrl } from './helpers/env';

/**
 * Read-only smoke for the Monday investor demo path (demo-readiness/DEMO-SCRIPT.md).
 * GETs only — no writes, no auth, safe against prod. The lead runs this after the
 * Sunday deploy to confirm the seeded `investor-demo` workspace is actually live and
 * none of the seed artifacts are held for moderation or missing.
 *
 *   npm run test:e2e:live:demo
 *   SHAREOUT_E2E_BASE_URL=https://shareout.site npm run test:e2e:live:demo
 *
 * Requires `npm run seed:investor-demo` to have been run against the target instance
 * first (per the preamble, that's local dev only until the lead gets Leo's OK for prod).
 */

const demoBaseUrl = (
  process.env.SHAREOUT_DEMO_BASE_URL ||
  (baseUrl.includes('shareout.site') ? baseUrl.replace('https://', 'https://investor-demo.') : `${baseUrl}/@investor-demo`)
).replace(/\/$/, '');

const ARTIFACT_SLUGS = ['revenue-overview', 'pipeline-health', 'support-queue', 'usage-trends', 'team-directory'];

const UNDER_REVIEW_MARKER = 'automated safety review';
const NOT_FOUND_MARKER = 'This page wandered off';

describe(`investor demo path smoke @ ${demoBaseUrl}`, () => {
  for (const slug of ARTIFACT_SLUGS) {
    it(`${slug} is live and not held for moderation`, async () => {
      const response = await fetch(`${demoBaseUrl}/${slug}/`, { redirect: 'follow' });
      const html = await response.text();

      expect(response.status, `expected 200 for ${slug}, got ${response.status}`).toBe(200);
      expect(html).not.toContain(UNDER_REVIEW_MARKER);
      expect(html).not.toContain(NOT_FOUND_MARKER);
    });

    it(`${slug} raw content includes its dashboard marker`, async () => {
      const response = await fetch(`${demoBaseUrl}/${slug}/index.html?_raw`, { redirect: 'follow' });
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('data-shareout-page="main"');
    });
  }

  it('workspace root does not 404', async () => {
    const response = await fetch(`${demoBaseUrl}/`, { redirect: 'follow' });
    // A workspace root with no index artifact may itself serve a plain 404 shell rather
    // than the platform not-found page — only fail on the platform's own "wandered off" copy.
    if (response.status === 404) {
      const html = await response.text();
      expect(html).not.toContain(NOT_FOUND_MARKER);
    } else {
      expect(response.status).toBeLessThan(500);
    }
  });
});
