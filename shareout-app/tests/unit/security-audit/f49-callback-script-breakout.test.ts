import { describe, expect, it } from 'vitest';
import { routeWorkspaceConnections } from '../../../src/router/api/workspace-connections-routes';
import { renderWorkspaceConnectionCallbackPage } from '../../../src/router/api/workspace-connections/callback-page';
import { renderPlatformConnectionCallbackPage } from '../../../src/data/platform/callback-page';
import { createFetchContext } from '../../../src/router/context';
import { e as env } from '../helpers/migrated-db';

const BREAK = '</script><script>window.__pwn=1</script>';

const noBreak = (body: string) => {
  expect(body).not.toContain('</script><script>window.__pwn');
  expect(body).toContain('\\u003c/script>');
};

describe('f49 callback pages: JSON.stringify inside inline script', () => {
  it('blocks: renderer escapes < inside the script block', async () => {
    const body = await renderWorkspaceConnectionCallbackPage(false, 'slack', BREAK).text();
    noBreak(body);
    expect(body).toContain('<p>&lt;/script&gt;');
    const ok = await renderWorkspaceConnectionCallbackPage(false, 'slack', 'denied').text();
    expect(ok).toContain('message: "denied"');
  });

  it('blocks: platform renderer escapes < inside the script block', async () => {
    noBreak(await renderPlatformConnectionCallbackPage(false, 'x', BREAK, `/a?${BREAK}`).text());
  });

  it('blocks: GET /v1/oauth/slack/callback?error_description=... cannot break out of the script', async () => {
    const url = `https://shareout.test/v1/oauth/slack/callback?error=x&error_description=${encodeURIComponent(BREAK)}`;
    const res = await routeWorkspaceConnections(createFetchContext(new Request(url), env));
    expect(res!.status).toBe(400);
    noBreak(await res!.text());
  });

  it('blocks: workspace connection callback cannot break out of the script', async () => {
    const url = `https://shareout.test/v1/workspaces/ws_any/connections/slack/callback?error=${encodeURIComponent(BREAK)}`;
    const res = await routeWorkspaceConnections(createFetchContext(new Request(url), env));
    noBreak(await res!.text());
  });
});
