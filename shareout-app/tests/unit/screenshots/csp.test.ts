import { describe, expect, it } from 'vitest';
import { cspAllows, directiveFor, parseCsp, sourceMatches } from '../../../src/screenshots/csp';
import { getArtifactCspOrigin, getSandboxedCSP } from '../../../src/serve/security';
import type { Env } from '../../../src/types';

const CDN = { SHAREOUT_BASE_URL: 'https://shareout.example', ARTIFACT_ORIGIN: 'https://cdn.example' } as unknown as Env;
const PAGE = 'https://1abc2def3456789012345678.cdn.example';
// The exact policies real viewers get (same builder as the serving path).
const tight = parseCsp(getSandboxedCSP(getArtifactCspOrigin(CDN), false, CDN));
const relaxed = parseCsp(getSandboxedCSP(getArtifactCspOrigin(CDN), true, CDN));
const locked = parseCsp(getSandboxedCSP(getArtifactCspOrigin(CDN), true, CDN, true));
const allows = (csp: typeof tight, directive: string, url: string) => cspAllows(csp, directive, new URL(url), PAGE);

describe('viewer CSP emulation', () => {
  it('public pages: scripts only from the allowlist, the page origin and the platform', () => {
    expect(allows(tight, 'script-src', 'https://evil-cdn.example.net/lib.js')).toBe(false);
    expect(allows(tight, 'script-src', 'https://cdn.jsdelivr.net/npm/x@1/x.js')).toBe(true);
    expect(allows(tight, 'script-src', `${PAGE}/app.js`)).toBe(true);
    expect(allows(tight, 'script-src', 'https://shareout.example/sdk/shareout.js')).toBe(true);
    expect(allows(tight, 'style-src', 'https://fonts.googleapis.com/css2?family=Inter')).toBe(true);
    expect(allows(tight, 'font-src', 'https://fonts.gstatic.com/s/inter.woff2')).toBe(true);
    expect(allows(tight, 'font-src', 'https://evil-cdn.example.net/f.woff2')).toBe(false);
    expect(allows(tight, 'img-src', 'https://images.example.org/a.png')).toBe(true);
    expect(allows(tight, 'connect-src', 'https://api.example.org/x')).toBe(true);
  });

  it('private pages: any https script, but not plain http', () => {
    expect(allows(relaxed, 'script-src', 'https://evil-cdn.example.net/lib.js')).toBe(true);
    expect(allows(relaxed, 'script-src', 'http://evil-cdn.example.net/lib.js')).toBe(false);
  });

  it('pages with MCP connections: egress only to the page and the platform', () => {
    expect(allows(locked, 'img-src', 'https://images.example.org/a.png')).toBe(false);
    expect(allows(locked, 'connect-src', 'https://shareout.example/v1/data/x')).toBe(true);
    expect(allows(locked, 'connect-src', 'https://api.example.org/x')).toBe(false);
  });
});

describe('CSP matching', () => {
  const at = (url: string) => new URL(url);

  it('keeps the first copy of a directive and falls back frame-src → child-src → default-src', () => {
    expect(parseCsp("Script-Src 'self'; script-src *").get('script-src')).toEqual(["'self'"]);
    const policy = parseCsp("default-src 'self'; child-src https://frames.example.org");
    expect(cspAllows(policy, 'frame-src', at('https://frames.example.org/embed'), PAGE)).toBe(true);
    expect(cspAllows(policy, 'img-src', at('https://frames.example.org/a.png'), PAGE)).toBe(false);
    expect(cspAllows(parseCsp("script-src 'self'"), 'img-src', at('https://any.example.org/a.png'), PAGE)).toBe(true);
  });

  it('matches wildcard hosts, ports, paths and scheme upgrades', () => {
    expect(sourceMatches('*.example.com', at('https://a.example.com/x'), PAGE)).toBe(true);
    expect(sourceMatches('*.example.com', at('https://example.com/x'), PAGE)).toBe(false);
    expect(sourceMatches('https://api.example.com:8443', at('https://api.example.com:8443/v1'), PAGE)).toBe(true);
    expect(sourceMatches('https://api.example.com:8443', at('https://api.example.com/v1'), PAGE)).toBe(false);
    expect(sourceMatches('https://x.example.com/lib/', at('https://x.example.com/lib/a.js'), PAGE)).toBe(true);
    expect(sourceMatches('https://x.example.com/lib/', at('https://x.example.com/other.js'), PAGE)).toBe(false);
    expect(sourceMatches('http:', at('https://a.example.com/'), PAGE)).toBe(true);
    expect(sourceMatches("'none'", at(`${PAGE}/a.js`), PAGE)).toBe(false);
  });

  it('maps resource types to the directive that governs them', () => {
    expect(directiveFor('script')).toBe('script-src');
    expect(directiveFor('fetch')).toBe('connect-src');
    expect(directiveFor('document')).toBe('frame-src');
    expect(directiveFor('other')).toBeNull();
  });
});
