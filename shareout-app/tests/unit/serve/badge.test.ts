import { describe, expect, it } from 'vitest';
import { badgeEnabled, injectBadge } from '../../../src/serve/badge';
import type { Env } from '../../../src/types';

const env = (vars: Record<string, string> = {}) => vars as unknown as Env;

describe('injectBadge', () => {
  it('appends the Made with ShareOut badge + report link into <body>', async () => {
    const resp = new Response('<html><body><h1>hi</h1></body></html>', {
      headers: { 'Content-Type': 'text/html' },
    });
    const out = await injectBadge(resp, 'art_1', 'https://acme.workers.dev').text();
    expect(out).toContain('Made with ShareOut');
    expect(out).toContain('https://acme.workers.dev/report/art_1');
    // The badge links to the instance that served the artifact, not the hosted one.
    expect(out).toContain('href="https://acme.workers.dev"');
    expect(out).not.toContain('shareout.site');
  });
});

describe('badgeEnabled', () => {
  // The badge used to be forced on for the free tier. Every account on a
  // self-hosted instance reads as free, so every public page carried an
  // unremovable watermark linking to someone else's product.
  it('is off unless the instance opts in', () => {
    expect(badgeEnabled(env())).toBe(false);
    expect(badgeEnabled(env({ ARTIFACT_BADGE: '0' }))).toBe(false);
  });

  it('is on when ARTIFACT_BADGE=1', () => {
    expect(badgeEnabled(env({ ARTIFACT_BADGE: '1' }))).toBe(true);
  });
});
