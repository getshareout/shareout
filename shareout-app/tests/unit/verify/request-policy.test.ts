import { describe, expect, it } from 'vitest';
import { cspAllows, decideRequest, isPrivateNetworkHost, parseCsp, type RequestPolicy } from '../../../src/verify/request-policy';
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

describe('isPrivateNetworkHost', () => {
  it.each(['localhost', 'app.localhost', '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '[fd00::1]', '[fe80::1]', 'db.internal', 'printer.local'])(
    '%s is private', (host) => expect(isPrivateNetworkHost(host)).toBe(true),
  );
  it.each(['example.com', '8.8.8.8', '172.32.0.1', '[2606:4700::1111]'])(
    '%s is public', (host) => expect(isPrivateNetworkHost(host)).toBe(false),
  );
});

describe('decideRequest', () => {
  const target = `${PAGE}/c/abc/?_capture=tok`;
  const policy: RequestPolicy = { targetUrl: target, pageOrigin: PAGE, ownHosts: ['shareout.example', new URL(PAGE).hostname], csp: tight };

  it('lets the main frame load only the page itself', () => {
    expect(decideRequest(policy, { url: target, resourceType: 'document', mainFrameNavigation: true })).toEqual({ allow: true });
    expect(decideRequest(policy, { url: 'https://example.com/', resourceType: 'document', mainFrameNavigation: true }))
      .toEqual({ allow: false, reason: 'navigation' });
  });

  it('refuses private-network hosts and non-web schemes, but not this instance', () => {
    expect(decideRequest(policy, { url: 'http://169.254.169.254/latest/meta-data', resourceType: 'fetch', mainFrameNavigation: false }))
      .toEqual({ allow: false, reason: 'private_network' });
    expect(decideRequest(policy, { url: 'file:///etc/passwd', resourceType: 'fetch', mainFrameNavigation: false }))
      .toEqual({ allow: false, reason: 'scheme' });
    const local: RequestPolicy = { ...policy, ownHosts: ['localhost'] };
    expect(decideRequest(local, { url: 'http://localhost:55162/v1/data/x', resourceType: 'fetch', mainFrameNavigation: false })).toEqual({ allow: true });
  });

  it('applies the viewer CSP per resource type', () => {
    expect(decideRequest(policy, { url: 'https://evil-cdn.example.net/lib.js', resourceType: 'script', mainFrameNavigation: false }))
      .toEqual({ allow: false, reason: 'csp', directive: 'script-src' });
    expect(decideRequest(policy, { url: 'data:image/png;base64,AA==', resourceType: 'image', mainFrameNavigation: false })).toEqual({ allow: true });
  });
});
