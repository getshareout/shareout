import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  artifactIdFromCdnHostname,
  detectArtifactId,
  detectBaseUrl,
} from '../src/core/detection';

const TSML_LABEL = '5d2e74a1a5c183a39c446fa9';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('artifactIdFromCdnHostname', () => {
  it('maps per-artifact CDN host to art_<hex>', () => {
    expect(artifactIdFromCdnHostname(`${TSML_LABEL}.shareoutcdn.site`)).toBe(`art_${TSML_LABEL}`);
    expect(artifactIdFromCdnHostname('shareoutcdn.site')).toBe('');
    expect(artifactIdFromCdnHostname('acme.shareout.site')).toBe('');
  });
});

describe('detectArtifactId', () => {
  it('reads artifact id from CDN hostname (gated /c/<token>/ paths)', () => {
    vi.stubGlobal('window', {
      location: {
        hostname: `${TSML_LABEL}.shareoutcdn.site`,
        pathname: '/c/some-capability-token/index.html',
      },
    });
    expect(detectArtifactId()).toBe(`art_${TSML_LABEL}`);
  });

  it('reads deploy slug from /a/<slug>/ paths on the app origin', () => {
    vi.stubGlobal('window', {
      location: {
        hostname: 'acme.shareout.site',
        pathname: '/a/tsml-group-status/',
      },
    });
    expect(detectArtifactId()).toBe('tsml-group-status');
  });
});

describe('detectBaseUrl', () => {
  it('points data API at shareout.site when artifact runs on CDN', () => {
    vi.stubGlobal('window', {
      location: {
        hostname: `${TSML_LABEL}.shareoutcdn.site`,
        pathname: '/index.html',
        origin: `https://${TSML_LABEL}.shareoutcdn.site`,
      },
    });
    vi.stubGlobal('document', {
      querySelectorAll: () => [
        { getAttribute: () => 'https://shareout.site/sdk/shareout.js' },
      ],
    });
    expect(detectBaseUrl()).toBe('https://shareout.site');
  });
});
