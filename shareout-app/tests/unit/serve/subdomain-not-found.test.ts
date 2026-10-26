import { describe, expect, it } from 'vitest';
import './helpers/mocks';
import { BASE_URL, createServeEnv } from './helpers/env';
import { setupServeTestHooks } from './helpers/hooks';
import { handleFetch } from '../../../src/router/handle-fetch';

setupServeTestHooks();

const html = { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es-AR,es;q=0.9' };
const sub = (path: string) => new Request(BASE_URL.replace('https://', 'https://investor-demo.') + path, { headers: html });

describe('workspace subdomain 404', () => {
  it('serves the styled 404 for a missing page on a browser navigation', async () => {
    const { env } = createServeEnv({ namespaced: null, deployment: null });
    const res = await handleFetch(sub('/no-such-page'), env);
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Esta página se perdió');
    expect(body).not.toContain('no-such-page');
  });

  it('keeps plain text for non-HTML clients', async () => {
    const { env } = createServeEnv({ namespaced: null, deployment: null });
    const res = await handleFetch(new Request(sub('/no-such-page').url), env);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
  });
});
