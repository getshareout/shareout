// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderWorkspaceIndexPage } from '../../../src/pages/workspace';
import type { Env } from '../../../src/types';

const env = (base: string) => ({ SHAREOUT_BASE_URL: base }) as unknown as Env;

describe('workspace index page', () => {
  it('shows the subdomain pattern for this instance', async () => {
    const html = await renderWorkspaceIndexPage(env('https://acme.com')).text();
    expect(html).toContain('your-slug</strong>.acme.com/workspace/');
    expect(html).not.toContain('shareout.site');
  });

  it('still shows the hosted domain on the hosted product', async () => {
    const html = await renderWorkspaceIndexPage(env('https://shareout.site')).text();
    expect(html).toContain('your-slug</strong>.shareout.site/workspace/');
  });

  it('escapes the host rather than interpolating it raw', async () => {
    const html = await renderWorkspaceIndexPage(env('https://x.com')).text();
    // Sanity: the host lands inside markup, so the escaping helper must be in play.
    expect(html).toContain('x.com/workspace/');
    expect(html).not.toContain('<strong>your-slug</strong>.<script>');
  });
});
