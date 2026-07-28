import { describe, expect, it } from 'vitest';
import { corsHeadersForRequest } from '../../src/cors';

function corsFor(origin: string | null): Headers {
  const headers = new Headers();
  if (origin !== null) headers.set('Origin', origin);
  return corsHeadersForRequest(new Request('https://shareout.site/v1/data/art_1/json', { headers }));
}

describe('corsHeadersForRequest (ADR 30)', () => {
  it('echoes per-artifact content origins with credentials + Vary', () => {
    const h = corsFor('https://1abc2def3456789012345678.shareoutcdn.site');
    expect(h.get('Access-Control-Allow-Origin')).toBe('https://1abc2def3456789012345678.shareoutcdn.site');
    expect(h.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(h.get('Vary')).toBe('Origin');
  });

  it('echoes the content apex origin', () => {
    expect(corsFor('https://shareoutcdn.site').get('Access-Control-Allow-Origin')).toBe('https://shareoutcdn.site');
  });

  it('maps an opaque-origin ("null") sandbox request to a wildcard ACAO', () => {
    const h = corsFor('null');
    expect(h.get('Access-Control-Allow-Origin')).toBe('*');
    expect(h.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('still allows the app origin and rejects unknown origins', () => {
    expect(corsFor('https://shareout.site').get('Access-Control-Allow-Origin')).toBe('https://shareout.site');
    expect(corsFor('https://evil.example.com').get('Access-Control-Allow-Origin')).toBeNull();
  });
});
