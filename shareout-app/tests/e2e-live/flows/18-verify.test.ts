import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl, uniqueSlug } from '../helpers/env';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact } from '../helpers/test-artifact';

/**
 * Agent flow: publish → verify. The acceptance fixtures for Verify, against a live
 * instance. With Browser Rendering every fixture is rendered on desktop + phone; on an
 * instance without the binding the result is `partial` and only the source checks are
 * asserted.
 */

interface Issue { rule: string; severity: string; message: string; where?: string; hint?: string; viewports?: string[] }
interface Verify {
  status: string;
  partial_reason?: string;
  issues: Issue[];
  viewports: Array<{ viewport: string; screenshot: { url: string; width: number } | null }>;
}

const page = (title: string, body: string, head = '') =>
  `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head>\n<body>\n<main><h1>${title}</h1>${body}</main>\n</body>\n</html>`;

const FIXTURES: Record<string, Array<{ path: string; content: string; mime: string }>> = {
  clean: [{ path: 'index.html', content: page('Clean', '<p>All good here.</p>'), mime: 'text/html' }],
  throws: [{ path: 'index.html', content: page('Throws', '<p id="out">…</p>\n<script>\nconst total = 42;\ndocument.getElementById(\'missing\').textContent = String(total);\n</script>'), mime: 'text/html' }],
  storage: [{ path: 'index.html', content: page('Storage', '<p id="f">none</p>\n<script>\nconst saved = localStorage.getItem(\'filters\');\n</script>'), mime: 'text/html' }],
  wide: [{ path: 'index.html', content: page('Wide', '<table class="orders" style="width:1400px"><tr><th>Id</th><th>Customer</th></tr></table>'), mime: 'text/html' }],
  noalt: [{ path: 'index.html', content: page('No alt', '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="120" height="120">'), mime: 'text/html' }],
  abs: [
    { path: 'index.html', content: page('Absolute', '<p>Styled.</p>', '<link rel="stylesheet" href="/styles.css">'), mime: 'text/html' },
    { path: 'styles.css', content: 'h1 { color: #b91c1c; }', mime: 'text/css' },
  ],
};

describe(`18 agent publish → verify @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    for (const [name, files] of Object.entries(FIXTURES)) {
      const { response, body } = await client.publish({ name: `E2E verify ${name}`, slug: uniqueSlug(`e2e-vfy-${name}`), visibility: 'private', files });
      if (!response.ok || !body?.artifact?.id) throw new Error(`publish ${name} failed: ${response.status}`);
      ids[name] = body.artifact.id;
    }
  }, 90_000);

  afterAll(async () => {
    for (const id of Object.values(ids)) await cleanupTestArtifact(client, id);
  }, 60_000);

  async function verify(name: string): Promise<Verify> {
    const { response, body } = await client.request<Verify>(`/v1/artifacts/${ids[name]}/verify`, { method: 'POST', body: '{}' });
    expect(response.status, JSON.stringify(body)).toBe(200);
    return body!;
  }
  const rendered = (v: Verify) => v.partial_reason !== 'no_browser';
  const find = (v: Verify, rule: string) => v.issues.find((i) => i.rule === rule);

  it('clean page → pass with two screenshots', async () => {
    const v = await verify('clean');
    if (!rendered(v)) return expect(v.status).toBe('partial');
    expect(v.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(v.status).toBe('pass');
    expect(v.viewports.map((x) => x.viewport)).toEqual(['desktop', 'mobile']);
    for (const x of v.viewports) {
      expect(x.screenshot!.width).toBeLessThanOrEqual(800);
      const { response } = await client.request(new URL(x.screenshot!.url).pathname);
      expect(response.headers.get('Content-Type')).toBe('image/webp');
    }
  }, 60_000);

  it('page throwing on load → message and line', async () => {
    const v = await verify('throws');
    if (!rendered(v)) return;
    const issue = find(v, 'js_error');
    expect(issue?.message).toContain('Cannot set properties of null');
    expect(issue?.where).toMatch(/^index\.html:8:\d+$/);
  }, 60_000);

  it('localStorage → SecurityError', async () => {
    const v = await verify('storage');
    expect(find(v, 'browser_storage')).toBeTruthy();
    if (!rendered(v)) return;
    expect(find(v, 'storage_blocked')?.message).toContain('SecurityError');
  }, 60_000);

  it('1400px table on a phone → overflow selector', async () => {
    const v = await verify('wide');
    if (!rendered(v)) return;
    const mobile = v.issues.find((i) => i.rule === 'horizontal_overflow' && i.viewports?.includes('mobile'));
    expect(mobile?.where).toContain('table.orders');
  }, 60_000);

  it('missing alt → axe image-alt at serious or worse', async () => {
    const v = await verify('noalt');
    if (!rendered(v)) return;
    const issue = find(v, 'image-alt');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toMatch(/\((serious|critical),/);
  }, 60_000);

  it('absolute /styles.css → fix hint', async () => {
    const v = await verify('abs');
    const issue = find(v, 'absolute_path');
    expect(issue?.where).toMatch(/^index\.html:/);
    expect(issue?.hint).toContain('"styles.css"');
  }, 60_000);
});
