import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

beforeAll(async () => {
  await applyMigrations();
  await e.ARTIFACTS.put('workspace-logos/wsp_f75.svg', svg);
});

describe('f75 workspace logo SVG', () => {
  it('blocks: /wl/<ws>.svg is sandboxed and nosniff', async () => {
    const res = await handleFetch(new Request('https://shareout.example.com/wl/wsp_f75.svg'), e, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(res.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
