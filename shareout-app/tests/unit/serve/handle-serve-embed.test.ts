import { describe, expect, it, vi } from 'vitest';
import './helpers/mocks';
import {
  ARTIFACT_ID,
  BASE_URL,
  SLUG,
  assetsEntry,
  createServeEnv,
  defaultDeployment,
  readStreamResponse,
  serveRequest,
} from './helpers/env';
import { cacheStore, setupServeTestHooks } from './helpers/hooks';
import { handleServeEmbed } from '../../../src/serve';

setupServeTestHooks();

describe('handleServeEmbed', () => {
  const embedDeployment = {
    ...defaultDeployment,
    embed_allowed: 1,
    embed_origins: JSON.stringify(['https://partner.example.com']),
  };

  it('returns 404 when embed deployment is missing', async () => {
    const { env } = createServeEnv({ embedDeployment: null });
    const response = await handleServeEmbed(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(404);
  });

  it('returns 403 when embedding is disabled', async () => {
    const { env } = createServeEnv({
      embedDeployment: { ...embedDeployment, embed_allowed: 0 },
    });
    const response = await handleServeEmbed(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('Embedding disabled');
  });

  it('returns paused page when embed target is paused', async () => {
    const { env } = createServeEnv({
      embedDeployment: { ...embedDeployment, paused: 1 },
    });
    const response = await handleServeEmbed(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('temporarily unavailable');
  });

  it('returns private embed page for private artifacts', async () => {
    const { env } = createServeEnv({
      embedDeployment: { ...embedDeployment, visibility: 'private' },
    });
    const response = await handleServeEmbed(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('Private Content');
  });

  it('blocks disallowed embed origins', async () => {
    const { env } = createServeEnv({ embedDeployment });
    const response = await handleServeEmbed(
      new Request(`${BASE_URL}/embed/${SLUG}/`, {
        headers: { Origin: 'https://evil.example.com' },
      }),
      env,
      SLUG,
      '',
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Origin not allowed');
  });

  it('allows embed requests validated via Referer when Origin is absent', async () => {
    const { env } = createServeEnv({ embedDeployment });
    const response = await handleServeEmbed(
      new Request(`${BASE_URL}/embed/${SLUG}/`, {
        headers: { Referer: 'https://partner.example.com/page' },
      }),
      env,
      SLUG,
      '',
    );
    expect(response.status).toBe(200);
  });

  it('treats invalid embed origin JSON as unrestricted', async () => {
    const { env } = createServeEnv({
      embedDeployment: { ...embedDeployment, embed_origins: '{invalid-json' },
    });
    const response = await handleServeEmbed(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toContain('frame-ancestors *');
  });

  it('allows listed origin and serves embed viewer HTML', async () => {
    const { env } = createServeEnv({ embedDeployment });
    const response = await handleServeEmbed(
      new Request(`${BASE_URL}/embed/${SLUG}/`, {
        headers: { Origin: 'https://partner.example.com' },
      }),
      env,
      SLUG,
      '',
    );

    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('ShareOut Embed');
    expect(response.headers.get('Content-Security-Policy')).toContain('frame-ancestors https://partner.example.com');
    expect(html).toContain(`/embed/${SLUG}/index.html?_raw`);
  });

  it('renders markdown embeds through the type viewer instead of raw text', async () => {
    const markdownEmbed = {
      ...embedDeployment,
      entrypoint: 'notes.md',
      mime: 'text/markdown',
      r2_key: 'artifacts/demo/notes.md',
      artifact_type: 'markdown',
      type_metadata: JSON.stringify({ markdown: { toc: [], hasCodeBlocks: false } }),
    } as typeof embedDeployment;

    const { env } = createServeEnv({
      embedDeployment: markdownEmbed,
      assets: {
        'notes.md': { r2_key: 'artifacts/demo/notes.md', mime: 'text/markdown', size_bytes: 32 },
      },
      r2: {
        'artifacts/demo/notes.md': { body: '# Hello\n\nSome **bold** text.' },
      },
    });

    const response = await handleServeEmbed(
      new Request(`${BASE_URL}/embed/${SLUG}/`, {
        headers: { Origin: 'https://partner.example.com' },
      }),
      env,
      SLUG,
      '',
    );

    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('Content-Security-Policy')).toContain('frame-ancestors https://partner.example.com');
    expect(html).toContain('<h1 id="hello">Hello</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toContain('# Hello');
  });

  it('uses wildcard frame-ancestors when embed_origins is empty', async () => {
    const { env } = createServeEnv({
      embedDeployment: { ...embedDeployment, embed_origins: '[]' },
    });
    const response = await handleServeEmbed(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toContain('frame-ancestors *');
  });

  it('returns 404 when embed raw asset is missing from R2', async () => {
    const { env } = createServeEnv({
      embedDeployment,
      assets: {
        'app.js': { r2_key: 'missing/key', mime: 'application/javascript', size_bytes: 10 },
      },
      r2: {},
    });
    const response = await handleServeEmbed(serveRequest('app.js?_raw'), env, SLUG, 'app.js');
    expect(response.status).toBe(404);
  });

  it('serves embed raw assets with security headers', async () => {
    const { env } = createServeEnv({ embedDeployment });
    const response = await handleServeEmbed(
      serveRequest('app.js?_raw'),
      env,
      SLUG,
      'app.js',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/javascript');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.text()).toContain('console.log');
  });

  it('applies embed CSP headers to raw HTML assets', async () => {
    const { env } = createServeEnv({ embedDeployment });
    const response = await handleServeEmbed(
      serveRequest('index.html?_raw'),
      env,
      SLUG,
      'index.html',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html');
    expect(response.headers.get('Content-Security-Policy')).toContain('frame-ancestors https://partner.example.com');
  });

  it('returns 404 when embed asset row is missing', async () => {
    const { env } = createServeEnv({
      embedDeployment: {
        ...embedDeployment,
        entrypoint: 'missing.html',
        r2_key: null as unknown as string,
        mime: null as unknown as string,
        size_bytes: null as unknown as number,
      },
      assets: {},
    });
    const response = await handleServeEmbed(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(404);
  });
});
