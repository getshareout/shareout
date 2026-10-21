import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGlobalProxy, handleProxy } from '../../../src/proxy';
import type { DataContext } from '../../../src/data/middleware';
import type { Env } from '../../../src/types';

const html = '<script>alert(1)</script>';
afterEach(() => vi.unstubAllGlobals());

const stub = (type: string, body = html) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'Content-Type': type } })));

const env = {
  SHAREOUT_BASE_URL: 'https://shareout.example.com',
  DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
} as unknown as Env;
const req = (u: string) => new Request(`https://shareout.example.com/api/proxy?url=${encodeURIComponent(u)}`);

describe('f52 proxy relays upstream active content', () => {
  it.each(['text/html', 'image/svg+xml; charset=utf-8', 'application/xhtml+xml'])('blocks: global proxy neutralizes %s', async (type) => {
    stub(type);
    const res = await handleGlobalProxy(req('https://attacker.example/x'), env);
    expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment/);
  });

  it('blocks: per-artifact proxy neutralizes text/html', async () => {
    stub('text/html');
    const ctx = { env, artifactId: 'art_f52', origin: null } as unknown as DataContext;
    const res = await handleProxy(req('https://attacker.example/x'), ctx, '');
    expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment/);
  });

  it('legit: JSON keeps its type and stays readable via fetch', async () => {
    stub('application/json; charset=utf-8', '{"a":1}');
    const res = await handleGlobalProxy(req('https://api.example.net/d'), env);
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(await res.json()).toEqual({ a: 1 });
  });
});
