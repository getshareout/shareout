import { describe, expect, it } from 'vitest';
import { handleBlobs, isInlineType } from '../../../src/data/blobs/handler';
import type { DataContext } from '../../../src/data/middleware';

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

const serve = async (mime: string) => {
  const env = {
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ r2_key: 'k', mime_type: mime, size_bytes: svg.length, filename: 'x.svg', deliverable_visibility: null }) }) }) },
    ARTIFACTS: { get: async () => ({ body: new Response(svg).body }) },
  };
  const ctx = { env, artifactId: 'art_f16', artifact: { visibility: 'private' }, origin: null } as unknown as DataContext;
  return handleBlobs(new Request('https://shareout.example.com/x', { method: 'GET' }), ctx, 'blb_1/content');
};

describe('f16 parameterized SVG blob served inline', () => {
  it.each(['image/svg+xml; charset=utf-8', 'IMAGE/SVG+XML', 'image/svg+xml;charset=utf-8', 'application/xhtml+xml', 'text/xml'])('blocks: %s is not inline', async (mime) => {
    expect(isInlineType(mime)).toBe(false);
    const res = await serve(mime);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('blocks: inline media carries sandbox CSP and nosniff', async () => {
    const res = await serve('image/png');
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline/);
    expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('legit: png/video/pdf still inline', () => {
    for (const m of ['image/png', 'image/jpeg; x=1', 'video/mp4', 'application/pdf']) expect(isInlineType(m)).toBe(true);
  });
});
