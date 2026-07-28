/**
 * Index router test suite: jobs proxy landing.
 * Registered from `index.test.ts` so Vitest hoists `vi.mock` in the entry file.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HandlerMocks } from '../handlers';
import {
  APEX,
  SUB,
  authed,
  createEnv,
  fetchPath,
  handlerTag,
  githubState,
  sheetsState,
} from '../fixtures';

export function registerJobsProxyLandingTests(handlers: HandlerMocks): void {
describe('index router — jobs, proxy, workspace pages, landing', () => {
  it('dispatches scheduled job routes', async () => {
    expect(await handlerTag(await fetchPath('/v1/jobs', authed()))).toBe('handleListJobs');
    expect(await handlerTag(await fetchPath('/v1/jobs', authed({ method: 'POST', body: '{}' })))).toBe('handleCreateJob');
    expect(await handlerTag(await fetchPath('/v1/jobs/job_1', authed()))).toBe('handleGetJob');
    expect(await handlerTag(await fetchPath('/v1/jobs/job_1', authed({ method: 'PATCH', body: '{}' })))).toBe('handleUpdateJob');
    expect(await handlerTag(await fetchPath('/v1/jobs/job_1', authed({ method: 'DELETE' })))).toBe('handleDeleteJob');
  });

  it('delegates global proxy when authenticated', async () => {
    expect(await handlerTag(await fetchPath('/api/proxy?url=https://api.example.com', authed()))).toBe('handleGlobalProxy');
  });

  it('rejects unauthenticated global proxy (no open SSRF relay)', async () => {
    const response = await fetchPath('/api/proxy?url=https://api.example.com');
    expect(response.status).toBe(401);
  });

  it('redirects unauthenticated /home to Google login', async () => {
    const response = await fetchPath('/home');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('/auth/login?redirect=/home');
  });

  it('renders authenticated home dashboard', async () => {
    handlers.getSessionUser.mockResolvedValueOnce({ id: 'usr_1', email: 'owner@example.com' });
    const env = createEnv((sql) => {
      if (sql.includes('FROM users WHERE id')) return { name: 'Owner', picture: null };
      if (sql.includes('FROM artifacts')) return [];
      if (sql.includes('COUNT(*)')) return { total: 0 };
      return null;
    });
    const response = await fetchPath('/home', { headers: { Cookie: 'session=valid' } }, APEX, env);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('ShareOut');
  });

  it('renders the workspace home shell at /home', async () => {
    handlers.getSessionUser.mockResolvedValueOnce({ id: 'usr_1', email: 'owner@example.com' });
    const env = createEnv((sql) => {
      if (sql.includes('SELECT name, picture FROM users WHERE id')) return { name: 'Owner', picture: null };
      if (sql.includes('COUNT(DISTINCT a.id)')) return { total: 0 };
      if (sql.includes('SELECT COALESCE(SUM(ad.views)')) return { total_views: 0 };
      return [];
    });
    const response = await fetchPath('/home', { headers: { Cookie: 'session=valid' } }, APEX, env);
    expect(response.status).toBe(200);
    const html = await response.text();
    // The reinvented workspace shell (wsx) is the only home surface now.
    expect(html).toContain('class="wsx__rail"');
    expect(html).toContain('class="wsx__canvas"');
    expect(html).toContain('id="wsxDock"');
  });

  it('redirects /workspace?slug= to subdomain', async () => {
    const response = await fetchPath('/workspace?slug=acme');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://acme.shareout.example.com/workspace/');
  });

  it('redirects apex /workspace/<slug> to the gated subdomain (no public list)', async () => {
    const response = await fetchPath('/workspace/acme/', undefined, APEX);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://acme.shareout.example.com/workspace/');
  });

  // No MARKETING_ORIGIN configured — the self-host default. There is no marketing
  // site in this repo, so an anonymous apex visitor is sent to sign in.
  it('redirects anonymous root to login when no marketing site is configured', async () => {
    const response = await fetchPath('/');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('/auth/login');
  });

  it('404s unclaimed apex paths when no marketing site is configured', async () => {
    const response = await fetchPath('/about');
    expect(response.status).toBe(404);
  });

  it('proxies unclaimed apex GETs when MARKETING_ORIGIN is set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>marketing</html>', { headers: { 'Content-Type': 'text/html' } }),
    );
    try {
      const env = createEnv(undefined, { MARKETING_ORIGIN: 'marketing.example.com' });
      const response = await fetchPath('/about', undefined, APEX, env);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain('marketing');
      expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://marketing.example.com/about/');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('blocks US visitors on the marketing homepage when MARKETING_US_BLOCKED is set', async () => {
    const env = createEnv(undefined, {
      MARKETING_US_BLOCKED: '1',
      MARKETING_ORIGIN: 'marketing.example.com',
    });
    const blocked = await fetchPath('/', { headers: { 'CF-IPCountry': 'US' } }, APEX, env);
    expect(blocked.status).toBe(404);
    await expect(blocked.text()).resolves.toBe('Not Available');

    const otherRoute = await fetchPath('/create', { headers: { 'CF-IPCountry': 'US' } }, APEX, env);
    // Geo-block applies to / only; /create is gated by ai.create (off by default), not 404.
    expect(otherRoute.status).toBe(403);
  });

  it('404s landing and pricing when MARKETING_PAGES_DISABLED is set', async () => {
    const env = createEnv(undefined, {
      MARKETING_PAGES_DISABLED: '1',
      MARKETING_ORIGIN: 'marketing.example.com',
    });
    const home = await fetchPath('/', undefined, APEX, env);
    expect(home.status).toBe(404);
    await expect(home.text()).resolves.toBe('Not Available');

    const pricing = await fetchPath('/pricing', undefined, APEX, env);
    expect(pricing.status).toBe(404);

    const teamsPricing = await fetchPath('/teams/pricing', undefined, APEX, env);
    expect(teamsPricing.status).toBe(404);

    const about = await fetchPath('/about', undefined, APEX, env);
    expect(about.status).toBe(404);

    const create = await fetchPath('/create', undefined, APEX, env);
    expect(create.status).toBe(404);
  });

  it('does not block US visitors on workspace subdomain homepages', async () => {
    const env = createEnv((sql) => {
      if (sql.includes('FROM workspaces WHERE slug')) {
        return { id: 'ws_1', name: 'Acme', description: null };
      }
      return null;
    });
    // Private subdomain: an anonymous visitor is sent to sign in (not geo-blocked).
    const response = await fetchPath('/', { headers: { 'CF-IPCountry': 'US' } }, SUB, env);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/auth/login?redirect=/');
  });

  it('serves workspace info page without slug param', async () => {
    const response = await fetchPath('/workspace');
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('Workspace apps');
  });
});
}
