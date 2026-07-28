import { describe, it, expect, vi } from 'vitest';
import { routeServe } from '../../../src/router/serve-router';
import { createFetchContext } from '../../../src/router/context';
import type { Env } from '../../../src/types';

// GEO discovery files: /sitemap.xml and /llms.txt served on the apex marketing
// host only — workspace subdomains must NOT serve the apex sitemap.

function ctxFor(host: string, path: string) {
  return createFetchContext(new Request(`https://${host}${path}`), {} as Env);
}

describe('routeServe — GEO discovery files', () => {
  it('serves a sitemap index spanning marketing + product on the apex host', async () => {
    const res = await routeServe(ctxFor('shareout.site', '/sitemap.xml'));
    expect(res?.status).toBe(200);
    expect(res?.headers.get('Content-Type')).toContain('application/xml');
    const body = await res!.text();
    expect(body).toContain('<sitemapindex');
    expect(body).toContain('https://shareout.site/sitemap-0.xml');
    expect(body).toContain('https://shareout.site/sitemap-product.xml');
  });

  it('serves the product sitemap (urlset) on the apex host', async () => {
    const res = await routeServe(ctxFor('shareout.site', '/sitemap-product.xml'));
    expect(res?.status).toBe(200);
    expect(res?.headers.get('Content-Type')).toContain('application/xml');
    const body = await res!.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('https://shareout.site/create');
  });

  it('serves llms.txt on the apex host', async () => {
    const res = await routeServe(ctxFor('shareout.site', '/llms.txt'));
    expect(res?.status).toBe(200);
    expect(res?.headers.get('Content-Type')).toContain('text/plain');
    const body = await res!.text();
    expect(body).toContain('# ShareOut');
    expect(body).toContain('/v1/skill');
  });

  it('serves a permissive robots.txt with the sitemap on the apex host', async () => {
    const res = await routeServe(ctxFor('shareout.site', '/robots.txt'));
    expect(res?.status).toBe(200);
    expect(res?.headers.get('Content-Type')).toContain('text/plain');
    const body = await res!.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    // Defense-in-depth: keep crawlers off thumbnail / embed / delivery shapes.
    expect(body).toContain('Disallow: /t/');
    expect(body).toContain('Disallow: /embed/');
    expect(body).toContain('Disallow: /d/');
    expect(body).toContain('Sitemap: https://shareout.site/sitemap.xml');
  });

  it('serves the IndexNow key file on the apex host', async () => {
    const res = await routeServe(ctxFor('shareout.site', '/a7f3c9e21b8d4e6fa0c5d8b3e1f6a249.txt'));
    expect(res?.status).toBe(200);
    expect(await res!.text()).toBe('a7f3c9e21b8d4e6fa0c5d8b3e1f6a249');
  });

  it('serves Privacy and Terms as HTML on the apex host', async () => {
    const privacy = await routeServe(ctxFor('shareout.site', '/privacy'));
    const terms = await routeServe(ctxFor('shareout.site', '/terms'));
    expect(privacy?.status).toBe(200);
    expect(terms?.status).toBe(200);
    expect(privacy?.headers.get('Content-Type')).toContain('text/html');
    expect(terms?.headers.get('Content-Type')).toContain('text/html');
    expect(await privacy!.text()).toContain('Privacy Policy');
    expect(await terms!.text()).toContain('Terms of Service');
  });

  it('delegates About to the marketing site (routeServe returns null)', async () => {
    expect(await routeServe(ctxFor('shareout.site', '/about'))).toBeNull();
  });

  it('serves integrations.sh discovery files on the apex host', async () => {
    const integrations = await routeServe(ctxFor('shareout.site', '/.well-known/integrations.json'));
    expect(integrations?.status).toBe(200);
    expect(integrations?.headers.get('Content-Type')).toContain('application/json');
    const integrationsBody = JSON.parse(await integrations!.text());
    expect(integrationsBody.version).toBe(3);
    expect(integrationsBody.surfaces.some((s: { slug: string }) => s.slug === 'shareout-api')).toBe(true);

    const openapi = await routeServe(ctxFor('shareout.site', '/openapi.json'));
    expect(openapi?.status).toBe(200);
    expect(openapi?.headers.get('Content-Type')).toContain('application/json');
    const openapiBody = JSON.parse(await openapi!.text());
    expect(openapiBody.openapi).toBe('3.1.0');
    expect(openapiBody.info.title).toContain('ShareOut');

    const skillsIndex = await routeServe(ctxFor('shareout.site', '/.well-known/agent-skills/index.json'));
    expect(skillsIndex?.status).toBe(200);
    const skillsBody = JSON.parse(await skillsIndex!.text());
    expect(skillsBody.skills.some((s: { name: string }) => s.name === 'shareout')).toBe(true);

    const skillMd = await routeServe(ctxFor('shareout.site', '/.well-known/agent-skills/shareout/SKILL.md'));
    expect(skillMd?.status).toBe(200);
    expect(skillMd?.headers.get('Content-Type')).toContain('text/markdown');
    expect(await skillMd!.text()).toContain('# ShareOut Skill');
  });

  it('does NOT serve apex discovery files on a workspace subdomain', async () => {
    const integrations = await routeServe(ctxFor('acme.shareout.site', '/.well-known/integrations.json'));
    const openapi = await routeServe(ctxFor('acme.shareout.site', '/openapi.json'));
    const sitemap = await routeServe(ctxFor('acme.shareout.site', '/sitemap.xml'));
    const llms = await routeServe(ctxFor('acme.shareout.site', '/llms.txt'));
    expect(integrations === null || integrations?.status === 404).toBe(true);
    expect(openapi === null || openapi?.status === 404).toBe(true);
    // Falls through to later routing (not the apex sitemap/llms handler).
    expect(sitemap === null || sitemap?.headers.get('Content-Type')?.includes('application/xml') === false).toBe(true);
    expect(llms === null || (await llms!.text()).includes('# ShareOut') === false).toBe(true);
  });
});

// A self-hosted instance is not a marketing site. These files used to be hardcoded to
// the hosted apex, so a stranger's instance published a sitemap of someone else's
// domain, invited crawlers into a private workspace, and pitched plans that do not
// exist in this repo.
const SELF_HOSTED = { SHAREOUT_BASE_URL: 'https://acme.workers.dev' } as Env;

function selfHosted(path: string) {
  return createFetchContext(new Request(`https://acme.workers.dev${path}`), SELF_HOSTED);
}

describe('discovery files on a self-hosted instance', () => {
  it('robots.txt keeps crawlers out by default', async () => {
    const res = await routeServe(selfHosted('/robots.txt'));
    expect(res?.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain('Disallow: /');
    expect(body).not.toContain('shareout.site');
  });

  it('does not publish a sitemap it cannot own', async () => {
    for (const path of ['/sitemap.xml', '/sitemap-product.xml']) {
      const res = await routeServe(selfHosted(path));
      expect(res?.status).toBe(404);
      expect(await res!.text()).not.toContain('shareout.site');
    }
  });

  it('llms.txt names this instance and stays useful to agents', async () => {
    const res = await routeServe(selfHosted('/llms.txt'));
    expect(res?.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain('https://acme.workers.dev/v1/skill');
    expect(body).toContain('https://acme.workers.dev/openapi.json');
    // The pitch belongs to the marketing apex, not to a stranger's private instance.
    expect(body).not.toContain('https://shareout.site/demo');
    expect(body).not.toContain('https://shareout.site/use-cases');
  });
});

describe('llms.txt does not sell plans that do not exist', () => {
  it('has no pricing, tier or card vocabulary on the apex', async () => {
    const res = await routeServe(ctxFor('shareout.site', '/llms.txt'));
    const body = await res!.text();
    for (const banned of ['/pricing', '/teams/pricing', 'Enterprise plans', 'adding a card', 'free tier']) {
      expect(body).not.toContain(banned);
    }
  });
});

describe('pingIndexNow', () => {
  it('does not submit under the hosted key from another instance', async () => {
    const { pingIndexNow } = await import('../../../src/pages/seo');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await pingIndexNow(['https://acme.workers.dev/a/report/'], SELF_HOSTED);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('submits apex URLs from the apex', async () => {
    const { pingIndexNow } = await import('../../../src/pages/seo');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    try {
      await pingIndexNow(['https://shareout.site/a/report/'], {} as Env);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
      expect(body.host).toBe('shareout.site');
      expect(body.urlList).toEqual(['https://shareout.site/a/report/']);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
