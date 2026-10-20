import { describe, expect, it } from 'vitest';
import { routeWorkspaceConnections } from '../../../src/router/api/workspace-connections-routes';
import { renderWorkspaceConnectionCallbackPage } from '../../../src/router/api/workspace-connections/callback-page';
import { createFetchContext } from '../../../src/router/context';
import { e as env } from '../helpers/migrated-db';

const BREAK = '</script><script>window.__pwn=1</script>';

describe('f49 callback pages: JSON.stringify inside inline script', () => {
  it('CONFIRMS: renderer emits a literal </script> from message inside the script block', async () => {
    const body = await renderWorkspaceConnectionCallbackPage(false, 'slack', BREAK).text();
    expect(body).toContain(`message: "${BREAK}"`);
    expect(body).toContain('<p>&lt;/script&gt;'); // <p> is escaped, script block is not
  });

  it('CONFIRMS: unauthenticated GET /v1/oauth/slack/callback?error_description=... reaches the sink via the router', async () => {
    const url = `https://shareout.test/v1/oauth/slack/callback?error=x&error_description=${encodeURIComponent(BREAK)}`;
    const res = await routeWorkspaceConnections(createFetchContext(new Request(url), env));
    const body = await res!.text();
    expect(res!.status).toBe(400);
    expect(res!.headers.get('Content-Security-Policy')).toBeNull();
    expect(body).toContain(`message: "${BREAK}"`);
  });

  it('CONFIRMS: unauthenticated workspace connection callback reaches the sink', async () => {
    const url = `https://shareout.test/v1/workspaces/ws_any/connections/slack/callback?error=${encodeURIComponent(BREAK)}`;
    const res = await routeWorkspaceConnections(createFetchContext(new Request(url), env));
    const body = await res!.text();
    expect(body).toContain(`message: "${BREAK}"`);
  });
});
