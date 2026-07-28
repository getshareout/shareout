/**
 * Private-artifact privacy guarantees:
 *  - Unauthorized visitors must not see title / description / thumbnail / OG tags
 *  - Search/social crawlers get no special OG bypass (Googlebot included)
 *  - Gate pages always carry X-Robots-Tag: noindex
 */
import { describe, expect, it, vi } from 'vitest';
import './helpers/mocks';
import {
  defaultDeployment,
  createServeEnv,
  serveRequest,
  SLUG,
} from './helpers/env';
import { setupServeTestHooks } from './helpers/hooks';
import { handleServe } from '../../../src/serve';
import {
  loginPage,
  accessDeniedPage,
  passwordLoginPage,
} from '../../../src/auth/pages';
import { pausedPage, underReviewPage, takedownPage, NOINDEX_ROBOTS } from '../../../src/serve/utils';
import { renderEarlyHead } from '../../../src/serve/sandbox-viewer/early-head';

setupServeTestHooks();

describe('private artifact privacy', () => {
  it('does not serve OG preview pages to Googlebot (or any crawler) for private artifacts', async () => {
    const { env } = createServeEnv({
      deployment: {
        ...defaultDeployment,
        visibility: 'private',
        artifact_name: 'Secret Board Report',
        social_title: 'Secret Board Report',
        social_description: 'Q3 numbers nobody should see',
        thumbnail_ext: 'webp',
      },
    });
    const req = serveRequest('');
    // Spoof a search crawler — previously this returned a 200 OG page with the title.
    Object.defineProperty(req, 'headers', {
      value: new Headers({
        ...Object.fromEntries(req.headers.entries()),
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      }),
    });
    const response = await handleServe(req, env, SLUG, '');
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).not.toContain('Secret Board Report');
    expect(body).not.toContain('Q3 numbers');
    expect(body).not.toContain('og:title');
  });

  it('login gate is generic — no artifact title, no OG tags, noindex header', () => {
    const res = loginPage('secret-slug', 'Secret Board Report', {
      title: 'Secret Board Report',
      description: 'leaked',
      imageUrl: 'https://example.com/t/art_1.webp',
      canonicalUrl: 'https://example.com/a/secret-slug/',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('X-Robots-Tag')).toBe(NOINDEX_ROBOTS);
  });

  it('login gate HTML does not embed title or thumbnail', async () => {
    const res = loginPage('secret-slug', 'Secret Board Report');
    const html = await res.text();
    expect(html).toContain('Private content');
    expect(html).toContain('name="robots"');
    expect(html).not.toContain('Secret Board Report');
    expect(html).not.toContain('og:title');
    expect(html).not.toContain('/t/');
  });

  it('access denied page does not reveal the artifact name', async () => {
    const res = accessDeniedPage({
      slug: 'secret-slug',
      artifactName: 'Secret Board Report',
      userEmail: 'outsider@example.com',
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('X-Robots-Tag')).toBe(NOINDEX_ROBOTS);
    const html = await res.text();
    expect(html).not.toContain('Secret Board Report');
    expect(html).toContain('This content is private');
  });

  it('password gate is 401 noindex and hides the title', async () => {
    const res = passwordLoginPage('secret-slug', 'Secret Board Report');
    expect(res.status).toBe(401);
    expect(res.headers.get('X-Robots-Tag')).toBe(NOINDEX_ROBOTS);
    const html = await res.text();
    expect(html).not.toContain('Secret Board Report');
    expect(html).toContain('Password required');
  });

  it('paused / under-review / takedown pages omit artifact names', async () => {
    for (const page of [pausedPage('Secret'), underReviewPage('Secret'), takedownPage('Secret')]) {
      expect(page.headers.get('X-Robots-Tag')).toContain('noindex');
      const html = await page.text();
      expect(html).not.toContain('Secret');
    }
  });

  it('closed sandbox head sets noindex and omits social tags', () => {
    const head = renderEarlyHead(
      'Secret Board Report',
      '<meta property="og:title" content="Secret Board Report">',
      '',
      undefined,
      true,
    );
    expect(head).toContain('name="robots"');
    expect(head).toContain('noindex');
    expect(head).not.toContain('og:title');
    // Authorized viewers still get a real browser title.
    expect(head).toContain('Secret Board Report | ShareOut');
  });

  it('open sandbox head still emits social tags', () => {
    const head = renderEarlyHead(
      'Public Demo',
      '<meta property="og:title" content="Public Demo">',
      '',
      undefined,
      false,
    );
    expect(head).toContain('og:title');
    expect(head).not.toContain('name="robots"');
  });
});
