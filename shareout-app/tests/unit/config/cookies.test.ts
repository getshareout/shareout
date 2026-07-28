import { describe, expect, it } from 'vitest';
import { cookieDomainAttr, isShareoutOrigin } from '../../../src/auth/cookies';

describe('cookieDomainAttr', () => {
  it('scopes to platform apex for apex and subdomains', () => {
    expect(cookieDomainAttr('example.com', 'example.com')).toBe(' Domain=.example.com;');
    expect(cookieDomainAttr('acme.example.com', 'example.com')).toBe(' Domain=.example.com;');
  });

  it('skips localhost and workers.dev', () => {
    expect(cookieDomainAttr('localhost')).toBe('');
    expect(cookieDomainAttr('foo.workers.dev')).toBe('');
  });

  it('infers apex when platformHost omitted', () => {
    expect(cookieDomainAttr('acme.shareout.site')).toBe(' Domain=.shareout.site;');
  });
});

describe('isShareoutOrigin', () => {
  it('allows same-zone origins only', () => {
    expect(isShareoutOrigin('https://acme.example.com', 'example.com')).toBe(true);
    expect(isShareoutOrigin('https://evil.com', 'example.com')).toBe(false);
  });
});
