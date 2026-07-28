// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseSubdomain } from '../../../src/subdomain';
import { getCdnRegistrable, getPlatformHostname } from '../../../src/config/origins';
import type { Env } from '../../../src/types';

describe('parseSubdomain', () => {
  it('treats configured apex and www as non-subdomain', () => {
    expect(parseSubdomain('shareout.site', 'shareout.site')).toEqual({
      isSubdomain: false,
      workspaceSlug: null,
    });
    expect(parseSubdomain('www.shareout.site', 'shareout.site')).toEqual({
      isSubdomain: false,
      workspaceSlug: null,
    });
  });

  it('extracts workspace slug on custom apex', () => {
    expect(parseSubdomain('acme.example.com', 'example.com')).toEqual({
      isSubdomain: true,
      workspaceSlug: 'acme',
    });
  });

  it('ignores reserved labels', () => {
    expect(parseSubdomain('staging.example.com', 'example.com').isSubdomain).toBe(false);
    expect(parseSubdomain('www.example.com', 'example.com').isSubdomain).toBe(false);
  });

  it('ignores localhost', () => {
    expect(parseSubdomain('localhost', 'shareout.site').isSubdomain).toBe(false);
  });
});

describe('origins helpers', () => {
  it('reads platform host from SHAREOUT_BASE_URL', () => {
    const env = { SHAREOUT_BASE_URL: 'https://www.example.com' } as Env;
    expect(getPlatformHostname(env)).toBe('example.com');
  });

  it('defaults unset SHAREOUT_BASE_URL to founder hosted apex', () => {
    expect(getPlatformHostname({} as Env)).toBe('shareout.site');
  });

  it('returns CDN registrable only when ARTIFACT_ORIGIN differs', () => {
    const same = {
      SHAREOUT_BASE_URL: 'https://example.com',
    } as Env;
    expect(getCdnRegistrable(same)).toBeNull();

    const split = {
      SHAREOUT_BASE_URL: 'https://example.com',
      ARTIFACT_ORIGIN: 'https://cdn.example.net',
    } as Env;
    expect(getCdnRegistrable(split)).toBe('cdn.example.net');
  });

  // Local dev sets no SHAREOUT_BASE_URL, so getPlatformHostname reports the hosted apex and
  // the "same host" check cannot catch a localhost ARTIFACT_ORIGIN. Without the loopback
  // guard, handle-fetch sent every localhost request to the content-only dispatcher and the
  // whole app — /health included — returned 404 with nothing naming the cause.
  it('never treats a loopback ARTIFACT_ORIGIN as a separate content domain', () => {
    for (const origin of ['http://localhost:55162', 'http://127.0.0.1:8787', 'http://[::1]:9000']) {
      expect(getCdnRegistrable({ ARTIFACT_ORIGIN: origin } as Env)).toBeNull();
      expect(
        getCdnRegistrable({ SHAREOUT_BASE_URL: 'http://localhost:55162', ARTIFACT_ORIGIN: origin } as Env)
      ).toBeNull();
    }
  });
});
