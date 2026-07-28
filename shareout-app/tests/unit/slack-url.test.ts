import { describe, it, expect } from 'vitest';
import { buildArtifactUrl } from '../../src/slack/send';

const base = 'https://shareout.site';

describe('buildArtifactUrl', () => {
  it('uses the workspace subdomain + display_slug when subdomain is enabled', () => {
    expect(buildArtifactUrl(base, { slug: 'acme-programmatic', display_slug: 'acme-programmatic', workspace_slug: 'acme', subdomain_enabled: 1 }))
      .toBe('https://acme.shareout.site/acme-programmatic/');
  });

  it('uses the human display_slug on the subdomain, not the (possibly suffixed) routing slug', () => {
    expect(buildArtifactUrl(base, { slug: 'acme-programmatic-2', display_slug: 'acme-programmatic', workspace_slug: 'acme', subdomain_enabled: 1 }))
      .toBe('https://acme.shareout.site/acme-programmatic/');
  });

  it('falls back to apex /a/ when the workspace has no subdomain', () => {
    expect(buildArtifactUrl(base, { slug: 'foo', display_slug: 'foo', workspace_slug: 'acme', subdomain_enabled: 0 }))
      .toBe('https://shareout.site/a/foo/');
  });

  it('falls back to apex /a/ for a personal artifact (no workspace)', () => {
    expect(buildArtifactUrl(base, { slug: 'foo', display_slug: null, workspace_slug: null, subdomain_enabled: null }))
      .toBe('https://shareout.site/a/foo/');
  });

  it('never builds a subdomain URL where one cannot resolve (local dev)', () => {
    expect(buildArtifactUrl('http://localhost:55162', { slug: 'foo', display_slug: 'foo', workspace_slug: 'acme', subdomain_enabled: 1 }))
      .toBe('http://localhost:55162/a/foo/');
    expect(buildArtifactUrl('http://127.0.0.1:8787', { slug: 'foo', display_slug: 'foo', workspace_slug: 'acme', subdomain_enabled: 1 }))
      .toBe('http://127.0.0.1:8787/a/foo/');
  });

  // The guard used to be `apex.endsWith('shareout.site')`, which conflated "can
  // carry wildcard DNS" with "is the hosted domain" — so a self-hosted workspace
  // that had deliberately enabled subdomains was still forced onto apex links.
  it('builds the subdomain URL on a self-hosted domain', () => {
    expect(buildArtifactUrl('https://acme.com', { slug: 'q3', display_slug: 'q3', workspace_slug: 'marketing', subdomain_enabled: 1 }))
      .toBe('https://marketing.acme.com/q3/');
  });

  it('still falls back to apex on a self-hosted domain without subdomains', () => {
    expect(buildArtifactUrl('https://acme.com', { slug: 'q3', display_slug: 'q3', workspace_slug: 'marketing', subdomain_enabled: 0 }))
      .toBe('https://acme.com/a/q3/');
  });
});
