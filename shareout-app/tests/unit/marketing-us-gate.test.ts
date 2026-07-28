import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/types';
import {
  blockDisabledMarketingPages,
  blockUsMarketingHomepage,
  marketingPagesDisabled,
  marketingUsBlocked,
} from '../../src/marketing-us-gate';

const env = (overrides: Partial<Env> = {}): Env =>
  ({ SHAREOUT_BASE_URL: 'https://shareout.site', ...overrides } as Env);

describe('marketing-us-gate', () => {
  it('is off by default', () => {
    expect(marketingUsBlocked(env())).toBe(false);
    expect(marketingUsBlocked(env({ MARKETING_US_BLOCKED: '0' }))).toBe(false);
  });

  it('recognizes truthy env values', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE']) {
      expect(marketingUsBlocked(env({ MARKETING_US_BLOCKED: v }))).toBe(true);
    }
  });

  it('blocks US visitors on apex / when enabled', () => {
    const request = new Request('https://shareout.site/', {
      headers: { 'CF-IPCountry': 'US' },
    });
    const blocked = blockUsMarketingHomepage(request, env({ MARKETING_US_BLOCKED: '1' }), 'shareout.site', '/');
    expect(blocked?.status).toBe(404);
  });

  it('allows US visitors when disabled', () => {
    const request = new Request('https://shareout.site/', {
      headers: { 'CF-IPCountry': 'US' },
    });
    expect(blockUsMarketingHomepage(request, env(), 'shareout.site', '/')).toBeNull();
  });

  it('does not block non-US or subdomains when enabled', () => {
    const enabled = env({ MARKETING_US_BLOCKED: '1' });
    const ar = new Request('https://shareout.site/', { headers: { 'CF-IPCountry': 'AR' } });
    expect(blockUsMarketingHomepage(ar, enabled, 'shareout.site', '/')).toBeNull();

    const sub = new Request('https://acme.shareout.site/', { headers: { 'CF-IPCountry': 'US' } });
    expect(blockUsMarketingHomepage(sub, enabled, 'acme.shareout.site', '/')).toBeNull();
  });
});

describe('marketing pages disabled', () => {
  it('is off by default', () => {
    expect(marketingPagesDisabled(env())).toBe(false);
  });

  it('404s the entire apex marketing surface when enabled', () => {
    const e = env({ MARKETING_PAGES_DISABLED: '1' });
    expect(blockDisabledMarketingPages(e, 'shareout.site', '/')?.status).toBe(404);
    expect(blockDisabledMarketingPages(e, 'shareout.site', '/pricing')?.status).toBe(404);
    expect(blockDisabledMarketingPages(e, 'shareout.site', '/about')?.status).toBe(404);
    expect(blockDisabledMarketingPages(e, 'shareout.site', '/teams/pricing')?.status).toBe(404);
  });

  it('skips localhost and subdomains', () => {
    const e = env({ MARKETING_PAGES_DISABLED: '1' });
    expect(blockDisabledMarketingPages(e, 'localhost', '/')).toBeNull();
    expect(blockDisabledMarketingPages(e, 'acme.shareout.site', '/')).toBeNull();
  });
});
