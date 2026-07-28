// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { corsHeadersForRequest } from '../../src/cors';
import type { Env } from '../../src/types';

const env = (vars: Record<string, string> = {}) => vars as unknown as Env;
const SELF = env({ SHAREOUT_BASE_URL: 'https://acme.workers.dev' });

function allowFor(origin: string | null, e?: Env): string | null {
  const headers = new Headers();
  if (origin !== null) headers.set('Origin', origin);
  const req = new Request('https://acme.workers.dev/v1/artifacts', { headers });
  return corsHeadersForRequest(req, e).get('Access-Control-Allow-Origin');
}

describe('CORS allowlist', () => {
  // The allowlist named only the hosted product, so a self-hosted instance refused
  // cross-origin browser calls from its OWN pages. Sandboxed artifacts hid it: they
  // send `Origin: null` and take the wildcard branch.
  it('allows the instance its own origin', () => {
    expect(allowFor('https://acme.workers.dev', SELF)).toBe('https://acme.workers.dev');
  });

  it('allows the instance workspace subdomains', () => {
    expect(allowFor('https://marketing.acme.workers.dev', SELF)).toBe('https://marketing.acme.workers.dev');
  });

  it('allows a separate artifact origin and its subdomains', () => {
    const withCdn = env({ SHAREOUT_BASE_URL: 'https://acme.com', ARTIFACT_ORIGIN: 'https://sandbox.acme.net' });
    expect(allowFor('https://sandbox.acme.net', withCdn)).toBe('https://sandbox.acme.net');
    expect(allowFor('https://abc123.sandbox.acme.net', withCdn)).toBe('https://abc123.sandbox.acme.net');
  });

  it('still refuses an unrelated origin', () => {
    expect(allowFor('https://evil.example.com', SELF)).toBeNull();
  });

  // A hostname lands in a RegExp; a dot must not become "any character" and let a
  // lookalike domain through.
  it('does not let a lookalike host match through regex metacharacters', () => {
    expect(allowFor('https://acmeXworkers.dev', SELF)).toBeNull();
    expect(allowFor('https://sub.acmeXworkers.dev', SELF)).toBeNull();
  });

  it('keeps the hosted allowlist working with no env', () => {
    expect(allowFor('https://shareout.site')).toBe('https://shareout.site');
    expect(allowFor('https://claude.ai')).toBe('https://claude.ai');
    expect(allowFor('https://evil.example.com')).toBeNull();
  });

  it('still wildcards the opaque origin sandboxed artifacts send', () => {
    expect(allowFor('null', SELF)).toBe('*');
    expect(allowFor(null, SELF)).toBe('*');
  });

  it('tolerates a malformed ARTIFACT_ORIGIN without dropping the rest', () => {
    const bad = env({ SHAREOUT_BASE_URL: 'https://acme.workers.dev', ARTIFACT_ORIGIN: 'not a url' });
    expect(allowFor('https://acme.workers.dev', bad)).toBe('https://acme.workers.dev');
  });
});
