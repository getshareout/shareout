// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareOut } from '../src/index';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('ShareOut browser initialization', () => {
  it('hydrates JSON and table caches from embedded initial data', () => {
    const script = document.createElement('script');
    script.id = 'shareout-initial-data';
    script.textContent = JSON.stringify({
      artifactId: 'art_embed',
      baseUrl: 'https://cdn.example.com',
      json: { settings: { theme: 'dark' } },
      tables: {
        users: { rows: [{ id: '1', name: 'Ada' }], total: 1, hasMore: false },
      },
    });
    document.head.appendChild(script);

    const sdk = new ShareOut();
    expect(sdk._artifactId).toBe('art_embed');
    expect(sdk._baseUrl).toBe('https://cdn.example.com');
    expect(sdk.cacheStats.size).toBeGreaterThan(0);
  });

  it('detects artifact id and base URL from the current page', () => {
    vi.stubGlobal('location', {
      pathname: '/a/demo-app/page',
      origin: 'https://shareout.example.com',
      href: 'https://shareout.example.com/a/demo-app/page',
    });

    const script = { getAttribute: (name: string) => (name === 'src' ? 'https://shareout.example.com/sdk/shareout.js' : null) };
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([script] as unknown as NodeListOf<Element>);

    const sdk = new ShareOut();
    expect(sdk._artifactId).toBe('demo-app');
    expect(sdk._baseUrl).toBe('https://shareout.example.com');
  });
});
