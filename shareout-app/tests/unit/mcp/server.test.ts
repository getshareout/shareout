// The /mcp JSON-RPC endpoint: 401 discovery handshake, initialize/discover, tools/list,
// and publish_artifact wired to the real publish handler (mocked here at its boundary).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/publish/handle-publish', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  handlePublish: vi.fn(),
}));
vi.mock('../../../src/chat-agent/access', () => ({ listWorkspacesForUser: vi.fn() }));

import { handleMcp } from '../../../src/mcp/server';
import { handlePublish } from '../../../src/publish';
import { listWorkspacesForUser } from '../../../src/chat-agent/access';
import { createSchema, e, personalToken, resetData } from './setup';

const ORIGIN = 'https://shareout.test';
const ACME = { id: 'wsp_acme', name: 'Acme', slug: 'acme', role: 'member' as const, artifactCount: 3 };

async function rpc(token: string | null, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await handleMcp(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    e,
    ORIGIN,
  );
  return { res, body: res.status === 202 ? null : ((await res.json()) as Record<string, any>) };
}

beforeAll(async () => {
  await createSchema();
  await e.DB.prepare(
    'CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, display_slug TEXT, owner_id TEXT, workspace_id TEXT, deleted_at TEXT)'
  ).run();
});

beforeEach(async () => {
  await resetData();
  vi.mocked(handlePublish).mockReset();
  vi.mocked(listWorkspacesForUser).mockResolvedValue([ACME]);
});

describe('/mcp auth', () => {
  it('answers 401 with a resource_metadata pointer when signed out', async () => {
    const { res } = await rpc(null, 'initialize');
    expect(res.status).toBe(401);
    const challenge = res.headers.get('WWW-Authenticate')!;
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('WWW-Authenticate');
  });

  it('flags an invalid token', async () => {
    const { res } = await rpc('so_not-a-real-token', 'tools/list');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
  });

  it('405s GET (stateless server, no SSE stream)', async () => {
    const res = await handleMcp(new Request(`${ORIGIN}/mcp`), e, ORIGIN);
    expect(res.status).toBe(405);
  });
});

describe('/mcp protocol', () => {
  it('initialize negotiates a legacy version and carries the instructions', async () => {
    const token = await personalToken();
    const { body } = await rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(body!.result.protocolVersion).toBe('2025-06-18');
    expect(body!.result.capabilities.tools).toBeDefined();
    expect(body!.result.instructions).toMatch(/language/i);
    expect(body!.result.instructions).toMatch(/report_problem/);
  });

  it('server/discover lists supported versions; an unknown version is refused', async () => {
    const token = await personalToken();
    const { body } = await rpc(token, 'server/discover', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } });
    expect(body!.result.supportedVersions).toContain('2026-07-28');

    const bad = await rpc(token, 'tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } });
    expect(bad.res.status).toBe(400);
    expect(bad.body!.error.code).toBe(-32022);
  });

  it('acknowledges notifications with 202', async () => {
    const token = await personalToken();
    const res = await handleMcp(
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      }),
      e,
      ORIGIN,
    );
    expect(res.status).toBe(202);
  });

  it('tools/list exposes the connector tools, including ChatGPT search/fetch', async () => {
    const token = await personalToken();
    const { body } = await rpc(token, 'tools/list');
    const names = (body!.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'whoami', 'list_workspaces', 'list_artifacts', 'get_artifact', 'publish_artifact',
      'update_artifact', 'invite_members', 'list_members', 'resend_invite', 'revoke_invite',
      'knowledge_search', 'knowledge_entity', 'knowledge_facts', 'knowledge_status',
      'get_help', 'report_problem', 'search', 'fetch',
    ]));
    const publish = (body!.result.tools as Array<{ name: string; description: string }>).find((t) => t.name === 'publish_artifact')!;
    expect(publish.description).toMatch(/report_problem/);
  });

  it('unknown tool is an invalid-params error', async () => {
    const token = await personalToken();
    const { body } = await rpc(token, 'tools/call', { name: 'nope', arguments: {} });
    expect(body!.error.code).toBe(-32602);
  });
});

describe('publish_artifact', () => {
  it('publishes to the only workspace, visible to the workspace, and returns the link', async () => {
    const token = await personalToken();
    vi.mocked(handlePublish).mockResolvedValue(new Response(JSON.stringify({
      artifact: { id: 'art_1', type: 'html' },
      version: { id: 'ver_1', version_no: 1 },
      deployment: { slug: 'q3-report', url: `${ORIGIN}/a/q3-report/`, subdomain_url: 'https://acme.shareout.test/q3-report/' },
      visibility: 'workspace',
    }), { status: 201 }));

    const { body } = await rpc(token, 'tools/call', {
      name: 'publish_artifact',
      arguments: { title: 'Q3 report', content: '<html><body><h1>Q3</h1></body></html>' },
    });

    const result = body!.result;
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('https://acme.shareout.test/q3-report/');
    expect(result.content[0].text).toContain('everyone in the workspace "Acme"');
    expect(result.structuredContent.artifact_id).toBe('art_1');

    const req = vi.mocked(handlePublish).mock.calls[0][0] as Request;
    expect(req.headers.get('Authorization')).toBe(`Bearer ${token}`);
    const sent = (await req.json()) as Record<string, any>;
    expect(sent).toMatchObject({ name: 'Q3 report', slug: 'q3-report', workspace_id: 'wsp_acme', visibility: 'workspace', entrypoint: 'index.html' });
    expect(sent.files[0]).toMatchObject({ path: 'index.html', mime: 'text/html' });
  });

  it('never overwrites a same-named page: picks a fresh slug', async () => {
    const token = await personalToken();
    await e.DB.prepare("INSERT INTO artifacts (id, display_slug, owner_id, workspace_id) VALUES ('art_old', 'notes', 'usr_1', 'wsp_acme')").run();
    vi.mocked(handlePublish).mockResolvedValue(new Response(JSON.stringify({ deployment: { url: 'u' }, visibility: 'workspace' }), { status: 201 }));
    await rpc(token, 'tools/call', { name: 'publish_artifact', arguments: { title: 'Notes', content: '# Notes' } });
    const sent = (await (vi.mocked(handlePublish).mock.calls[0][0] as Request).json()) as Record<string, any>;
    expect(sent.slug).toMatch(/^notes-[0-9a-f]{5}$/);
    expect(sent.entrypoint).toBe('index.md');
    await e.DB.prepare('DELETE FROM artifacts').run();
  });

  it('asks which workspace when there are several', async () => {
    const token = await personalToken();
    vi.mocked(listWorkspacesForUser).mockResolvedValue([ACME, { ...ACME, id: 'wsp_two', name: 'Two', slug: 'two' }]);
    const { body } = await rpc(token, 'tools/call', { name: 'publish_artifact', arguments: { title: 'X', content: '<p>x</p>' } });
    expect(body!.result.structuredContent.needs_workspace).toBe(true);
    expect(handlePublish).not.toHaveBeenCalled();
  });

  it('surfaces a downgrade notice and failures plainly', async () => {
    const token = await personalToken();
    vi.mocked(handlePublish).mockResolvedValueOnce(new Response(JSON.stringify({
      deployment: { url: `${ORIGIN}/a/x/` },
      visibility: 'private',
      visibility_downgraded: true,
      requested_visibility: 'public',
      notice: 'Public links are off on this instance.',
    }), { status: 201 }));
    const down = await rpc(token, 'tools/call', { name: 'publish_artifact', arguments: { title: 'X', content: '<p>x</p>', visibility: 'public' } });
    expect(down.body!.result.content[0].text).toContain('Public links are off on this instance.');
    expect(down.body!.result.structuredContent.visibility_downgraded).toBe(true);

    vi.mocked(handlePublish).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Storage limit reached', code: 'STORAGE_LIMIT' }), { status: 413 }));
    const failed = await rpc(token, 'tools/call', { name: 'publish_artifact', arguments: { title: 'Y', content: '<p>y</p>' } });
    expect(failed.body!.result.isError).toBe(true);
    expect(failed.body!.result.content[0].text).toContain('Storage limit reached');
    expect(failed.body!.result.content[0].text).toContain('report_problem');
  });
});
