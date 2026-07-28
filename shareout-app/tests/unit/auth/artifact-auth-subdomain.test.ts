// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

// The handler does a lot besides redirect (token mint, D1 lookups); this exercises
// only the host → Location decision, which is where the bug was.
const { parseSubdomainFromEnv } = await import('../../../src/subdomain');

function locationFor(url: string, env: Env, slug = 'q3-report'): string {
  const host = new URL(url).hostname;
  return parseSubdomainFromEnv(host, env).isSubdomain ? `/${slug}` : `/a/${slug}/`;
}

const hosted = { SHAREOUT_BASE_URL: 'https://shareout.site' } as unknown as Env;
const selfHosted = { SHAREOUT_BASE_URL: 'https://acme.com' } as unknown as Env;

describe('post-password redirect target', () => {
  // Was a literal `.shareout.site` suffix check, so a self-hosted workspace
  // subdomain was never recognised and the redirect went to the apex path that
  // host does not serve.
  it('returns the subdomain path on a self-hosted workspace subdomain', () => {
    expect(locationFor('https://team.acme.com/q3-report', selfHosted)).toBe('/q3-report');
  });

  it('returns the apex path on the self-hosted apex', () => {
    expect(locationFor('https://acme.com/a/q3-report/', selfHosted)).toBe('/a/q3-report/');
  });

  it('still returns the subdomain path on the hosted product', () => {
    expect(locationFor('https://acme.shareout.site/q3-report', hosted)).toBe('/q3-report');
  });

  it('treats the hosted apex and www as apex', () => {
    expect(locationFor('https://shareout.site/a/q3-report/', hosted)).toBe('/a/q3-report/');
    expect(locationFor('https://www.shareout.site/a/q3-report/', hosted)).toBe('/a/q3-report/');
  });

  // A self-hosted instance must not treat the founder domain as its own subdomain.
  it('does not treat another instance domain as a subdomain of this one', () => {
    expect(locationFor('https://acme.shareout.site/q3-report', selfHosted)).toBe('/a/q3-report/');
  });
});
