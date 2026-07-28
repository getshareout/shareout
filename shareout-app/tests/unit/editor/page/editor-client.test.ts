import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { generateEditorPage } from '../../../../src/editor/page/generate-editor-page';
import { EDITOR_CLIENT_SCRIPT_URL } from '../../../../src/editor/page/generate-editor-page';
import { handleServeEditor } from '../../../../src/editor-serve';

describe('editor client bundle', () => {
  it('loads editor via script tag instead of inline module', () => {
    const html = generateEditorPage({
      artifactId: 'art_test',
      slug: 'demo',
    });

    expect(html).toContain(`<script type="module" src="${EDITOR_CLIENT_SCRIPT_URL}"></script>`);
    expect(html).not.toContain('async function init()');
  });

  it('serves bundled JavaScript at /sdk/editor.js', async () => {
    const response = await handleServeEditor(
      new Request('https://shareout.site/sdk/editor.js', {
        headers: { 'Sec-Fetch-Dest': 'script' },
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('javascript');

    const body = await response.text();
    expect(body.length).toBeGreaterThan(10_000);
    expect(body).toContain('EDITOR_CONFIG');
    expect(body).toMatch(/\/v1\/artifacts\/.*\/editor/);
  });
});
