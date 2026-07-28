import { describe, expect, it } from 'vitest';
import { isBlockedDestination, validateAllowedHost } from '../../src/data/secrets/blocklist';
import { matchesAllowedPath, validatePathPatterns } from '../../src/data/secrets/path-matcher';
import {
  artifactContentHost,
  artifactContentUrl,
  findBlockedOpenScriptHosts,
  findBlockedOpenStyleHosts,
  getArtifactCspOrigin,
  getSandboxedCSP,
  isCdnArtifactOrigin,
} from '../../src/serve/security';
import type { Env } from '../../src/types';

const APP_ENV = { SHAREOUT_BASE_URL: 'https://shareout.site', ARTIFACT_ORIGIN: 'https://shareout.site' } as unknown as Env;
const CDN_ENV = { SHAREOUT_BASE_URL: 'https://shareout.site', ARTIFACT_ORIGIN: 'https://shareoutcdn.site' } as unknown as Env;
const ART = 'art_1abc2def3456789012345678';
const LABEL = '1abc2def3456789012345678';

describe('artifact content origin helpers (ADR 30)', () => {
  it('detects whether the cutover origin is live', () => {
    expect(isCdnArtifactOrigin(APP_ENV)).toBe(false);
    expect(isCdnArtifactOrigin(CDN_ENV)).toBe(true);
  });

  it('derives the per-artifact content host from the immutable id hex suffix', () => {
    expect(artifactContentHost(APP_ENV, ART)).toBeNull();
    expect(artifactContentHost(CDN_ENV, ART)).toBe(`${LABEL}.shareoutcdn.site`);
  });

  it('builds legacy same-origin raw URLs before cutover', () => {
    expect(artifactContentUrl(APP_ENV, ART, 'demo', 'index.html')).toBe(
      'https://shareout.site/a/demo/index.html?_raw',
    );
  });

  it('builds per-id subdomain URLs after cutover (public = no token, private = /c/<ct>/)', () => {
    expect(artifactContentUrl(CDN_ENV, ART, 'demo', 'index.html')).toBe(
      `https://${LABEL}.shareoutcdn.site/index.html`,
    );
    expect(artifactContentUrl(CDN_ENV, ART, 'demo', 'app.js', 'tok123')).toBe(
      `https://${LABEL}.shareoutcdn.site/c/tok123/app.js`,
    );
  });

  it('names a wildcard CSP origin on the content domain (opaque-origin "self" cannot match)', () => {
    expect(getArtifactCspOrigin(APP_ENV)).toBe('https://shareout.site');
    expect(getArtifactCspOrigin(CDN_ENV)).toBe('https://*.shareoutcdn.site');
  });

  it('tight sandbox CSP allowlists specific reputable CDN hosts, not arbitrary https', () => {
    const csp = getSandboxedCSP('https://shareout.site', false, APP_ENV);
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).toContain('https://cdn.jsdelivr.net');
    expect(scriptSrc).toContain('https://cdn.tailwindcss.com'); // Tailwind Play CDN is allowlisted
    expect(scriptSrc).toContain('https://shareout.site');
    // A bare `https:` source would let any host load — the tight variant must not.
    expect(scriptSrc).not.toMatch(/\bhttps:(?!\/\/)/);
    expect(scriptSrc).not.toContain('evil-cdn.example');
    expect(csp).toContain("frame-ancestors 'self' shareout.site *.shareout.site");
  });

  it('relaxed sandbox CSP (private/authed-only) allows scripts, styles and fonts from any https host', () => {
    const csp = getSandboxedCSP('https://shareout.site', true, APP_ENV);
    const dir = (name: string) => csp.split('; ').find((d) => d.startsWith(name))!;
    expect(dir('script-src')).toMatch(/\bhttps:(?!\/\/)/); // any CDN loads
    expect(dir('style-src')).toMatch(/\bhttps:(?!\/\/)/);
    expect(dir('font-src')).toMatch(/\bhttps:(?!\/\/)/);
    expect(csp).toContain("'unsafe-inline'");
  });

  it('findBlockedOpenScriptHosts flags only non-allowlisted external script hosts', () => {
    expect(findBlockedOpenScriptHosts(['cdn.jsdelivr.net', 'cdn.tailwindcss.com', 'code.jquery.com'], APP_ENV)).toEqual([]);
    // own content domain + localhost are always fine
    expect(findBlockedOpenScriptHosts(['abc123.shareoutcdn.site', 'localhost:55162'], CDN_ENV)).toEqual([]);
    // platform apex allowed via env
    expect(findBlockedOpenScriptHosts(['shareout.site'], APP_ENV)).toEqual([]);
    // a random / niche CDN is blocked on open pages (allowed only on private)
    expect(findBlockedOpenScriptHosts(['unknown-cdn.example.com', 'unpkg.com'], APP_ENV)).toEqual(['unknown-cdn.example.com']);
  });

  it('findBlockedOpenStyleHosts allows Google Fonts / Fontshare on top of the CDN allowlist', () => {
    expect(findBlockedOpenStyleHosts(['fonts.googleapis.com', 'cdn.jsdelivr.net', 'cdn.fontshare.com'])).toEqual([]);
    expect(findBlockedOpenStyleHosts(['niche-css.example.com'])).toEqual(['niche-css.example.com']);
  });
});

describe('matchesAllowedPath', () => {
  it('matches exact paths after normalizing slashes and query strings', () => {
    expect(matchesAllowedPath('api//users/?page=1', ['/api/users'])).toBe(true);
  });

  it('supports single-segment and deep wildcard patterns', () => {
    expect(matchesAllowedPath('/api/users/123', ['/api/users/*'])).toBe(true);
    expect(matchesAllowedPath('/api/users/123/profile', ['/api/users/*'])).toBe(false);
    expect(matchesAllowedPath('/assets/images/icons/logo.svg', ['/assets/**'])).toBe(true);
  });

  it('validates path pattern inputs', () => {
    expect(validatePathPatterns(['/api/**'])).toEqual({ valid: true });
    expect(validatePathPatterns([])).toMatchObject({ valid: false });
    expect(validatePathPatterns(['/safe', '../secret'])).toMatchObject({
      valid: false,
      error: 'Path traversal not allowed',
    });
  });

  it('matches global wildcard patterns and rejects invalid pattern metadata', () => {
    expect(matchesAllowedPath('/anything/deep', ['/**'])).toBe(true);
    expect(matchesAllowedPath('/nested/route', ['**'])).toBe(true);
    expect(matchesAllowedPath('/api/v1/users', ['/api/**/users'])).toBe(true);
    expect(validatePathPatterns([123 as unknown as string])).toMatchObject({
      valid: false,
      error: 'Path patterns must be strings',
    });
    expect(validatePathPatterns(['/' + 'a'.repeat(501)])).toMatchObject({
      valid: false,
      error: 'Path pattern too long (max 500 chars)',
    });
  });
});

describe('isBlockedDestination', () => {
  it('blocks invalid, local, private, internal, and unsafe destinations', () => {
    expect(isBlockedDestination('not a url')).toMatchObject({ blocked: true });
    expect(isBlockedDestination('http://localhost')).toMatchObject({ blocked: true });
    expect(isBlockedDestination('https://10.0.0.1')).toMatchObject({ blocked: true });
    expect(isBlockedDestination('https://service.internal')).toMatchObject({ blocked: true });
    expect(isBlockedDestination('ftp://example.com')).toMatchObject({ blocked: true });
    expect(isBlockedDestination('https://example.com:22')).toMatchObject({ blocked: true });
  });

  it('allows public http and https destinations on normal ports', () => {
    expect(isBlockedDestination('https://api.example.com/v1')).toEqual({ blocked: false });
    expect(isBlockedDestination('http://api.example.com/v1')).toEqual({ blocked: false });
  });
});

describe('validateAllowedHost', () => {
  it('matches exact hosts and wildcard subdomains case-insensitively', () => {
    expect(validateAllowedHost('API.EXAMPLE.COM', ['api.example.com'])).toBe(true);
    expect(validateAllowedHost('reports.example.com', ['*.example.com'])).toBe(true);
    expect(validateAllowedHost('example.com', ['*.example.com'])).toBe(true);
    expect(validateAllowedHost('evil.com', ['*.example.com'])).toBe(false);
  });
});
