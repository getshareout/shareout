import { describe, expect, it } from 'vitest';
import './helpers/mocks';
import { ARTIFACT_ID, BASE_URL, SLUG, assetsEntry, createServeEnv, defaultDeployment, serveRequest } from './helpers/env';
import { setupServeTestHooks } from './helpers/hooks';
import { handleServe } from '../../../src/serve';

setupServeTestHooks();

// Multi-page artifact: an index that links to sibling pages.
const multiPage = () => {
  const assets = {
    'index.html': assetsEntry('index.html'),
    'docs/step-1.html': assetsEntry('docs/step-1.html'),
    'app.js': assetsEntry('app.js'),
  };
  const r2 = {
    'artifacts/demo/index.html': { body: '<html><head></head><body><a href="docs/step-1.html">Step 1</a></body></html>' },
    'artifacts/demo/docs/step-1.html': { body: '<html><head></head><body><h1>Step 1</h1></body></html>' },
    'artifacts/demo/app.js': { body: 'void 0' },
  };
  const deployment = { ...defaultDeployment, has_mobile: 0, mobile_entrypoint: '' };
  return createServeEnv({ assets, r2, deployment });
};

describe('multi-page artifacts: page agent in served pages', () => {
  it('injects the page agent into a raw sibling page with its own path', async () => {
    const { env, slugsStore } = multiPage();
    slugsStore.set(`cmtcfg:${ARTIFACT_ID}`, '0');
    const res = await handleServe(serveRequest('docs/step-1.html?_raw'), env, SLUG, 'docs/step-1.html');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1>Step 1</h1>');
    expect(html).toContain("type:'shareout:page'");
    expect(html).toContain('P="docs/step-1.html"');
    expect(html).toContain(`S="${SLUG}"`);
    expect(html).toContain(`B="${BASE_URL}"`);
    // Same cache variant as before (the agent is per r2_key, so it adds no key).
    expect(res.headers.get('ETag')).toBe('"artifacts/demo/docs/step-1.html:raw:sbx"');
  });

  it('injects the agent into the raw entrypoint served at the content root', async () => {
    const { env } = multiPage();
    const res = await handleServe(serveRequest('?_raw'), env, SLUG, '', { contentOrigin: true });
    const html = await res.text();
    expect(html).toContain('P="index.html"');
  });

  it('injects the agent into a same-zone sibling page reached without ?_raw', async () => {
    const { env } = multiPage();
    const res = await handleServe(serveRequest('docs/step-1.html'), env, SLUG, 'docs/step-1.html');
    const html = await res.text();
    expect(html).toContain('P="docs/step-1.html"');
  });

  it('leaves non-HTML assets untouched', async () => {
    const { env } = multiPage();
    const res = await handleServe(serveRequest('app.js'), env, SLUG, 'app.js');
    expect(await res.text()).toBe('void 0');
  });
});

describe('multi-page artifacts: viewer ?page=', () => {
  const contentSrc = (html: string) => html.match(/<iframe[^>]*src="([^"]+)"/)?.[1] ?? '';

  it('opens the viewer on a sibling HTML page and keeps the real entrypoint for the bridge', async () => {
    const { env } = multiPage();
    const res = await handleServe(serveRequest('?page=docs%2Fstep-1.html&wsx=1'), env, SLUG, '');
    const html = await res.text();
    expect(contentSrc(html)).toBe(`${BASE_URL}/a/${SLUG}/docs/step-1.html?_raw`);
    expect(html).toContain('E="index.html"');
    expect(html).toContain('shell=true');
  });

  it('falls back to the entrypoint for unsafe, missing or non-HTML pages', async () => {
    const { env } = multiPage();
    for (const page of ['..%2Fsecret.html', 'missing.html', 'app.js', '%2Fetc%2Fpasswd', 'index.html']) {
      const html = await (await handleServe(serveRequest(`?page=${page}`), env, SLUG, '')).text();
      expect(contentSrc(html), page).toBe(`${BASE_URL}/a/${SLUG}/index.html?_raw`);
    }
  });

  it('standalone viewer bridge is not in shell mode', async () => {
    const { env } = multiPage();
    const html = await (await handleServe(serveRequest(''), env, SLUG, '')).text();
    expect(html).toContain('shell=false');
  });

  it('does not bypass the access gate of a private artifact', async () => {
    const { env } = createServeEnv({ deployment: { ...defaultDeployment, visibility: 'private' } });
    const res = await handleServe(serveRequest('?page=docs%2Fstep-1.html'), env, SLUG, '');
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('step-1');
  });

  it('does not bypass the content-domain capability token', async () => {
    const { env } = createServeEnv({ deployment: { ...defaultDeployment, visibility: 'private' } });
    const res = await handleServe(serveRequest('docs/step-1.html?_raw&page=x.html'), env, SLUG, 'docs/step-1.html', { contentOrigin: true });
    expect(res.status).toBe(403);
  });
});
