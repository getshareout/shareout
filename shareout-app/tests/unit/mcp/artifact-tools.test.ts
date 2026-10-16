// Page tools over MCP: argument validation against inputSchema, workspace scoping for
// list_artifacts/search, rename on update_artifact, and filing into folders.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/publish/handle-publish', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  handlePublish: vi.fn(),
}));
vi.mock('../../../src/artifacts/crud', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  handleListArtifacts: vi.fn(),
  handleUpdateArtifact: vi.fn(),
  handleGetArtifact: vi.fn(),
}));
vi.mock('../../../src/artifacts/roles', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireRole: vi.fn(async () => null),
}));
vi.mock('../../../src/search/quick-search', () => ({ quickSearch: vi.fn() }));
vi.mock('../../../src/chat-agent/access', () => ({ listWorkspacesForUser: vi.fn() }));

import { callTool } from '../../../src/mcp/tools';
import { NOT_MEMBER } from '../../../src/mcp/tool-kit';
import { handlePublish } from '../../../src/publish/handle-publish';
import { handleGetArtifact, handleListArtifacts, handleUpdateArtifact } from '../../../src/artifacts/crud';
import { quickSearch } from '../../../src/search/quick-search';
import { listWorkspacesForUser } from '../../../src/chat-agent/access';
import { createSchema, e, resetData } from './setup';

const ctx = { env: e, user: { id: 'usr_1', email: 'ana@example.com', username: null }, origin: 'https://shareout.test', authorization: 'Bearer so_x' };
const ACME = { id: 'wsp_acme', name: 'Acme', slug: 'acme', role: 'member' as const, artifactCount: 1 };
const TWO = { ...ACME, id: 'wsp_two', name: 'Two', slug: 'two' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const published = () => json({ artifact: { id: 'art_1' }, version: { version_no: 2 }, deployment: { url: 'https://shareout.test/a/x/' }, visibility: 'workspace' }, 201);
const sentPublish = async () => (await (vi.mocked(handlePublish).mock.calls[0][0] as Request).json()) as Record<string, unknown>;

beforeAll(async () => {
  await createSchema();
  await e.DB.prepare(
    'CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, display_slug TEXT, owner_id TEXT, workspace_id TEXT, visibility TEXT, artifact_type TEXT, deleted_at TEXT)'
  ).run();
  await e.DB.prepare('CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT)').run();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetData();
  await e.DB.prepare('DELETE FROM artifacts').run();
  await e.DB.prepare('DELETE FROM folders').run();
  await e.DB.prepare("INSERT INTO artifacts VALUES ('art_1', 'Q3 report', 'q3-report', 'usr_1', 'wsp_acme', 'private', 'markdown', NULL)").run();
  await e.DB.prepare("INSERT INTO folders VALUES ('fld_1', 'wsp_acme', 'Reports'), ('fld_2', 'wsp_acme', 'Drafts'), ('fld_3', 'wsp_acme', 'drafts'), ('fld_9', 'wsp_two', 'Reports')").run();
  vi.mocked(listWorkspacesForUser).mockResolvedValue([ACME, TWO]);
  vi.mocked(handlePublish).mockImplementation(async () => published());
});

describe('argument validation', () => {
  it('refuses an unknown visibility without publishing (never widens it)', async () => {
    const r = (await callTool(ctx, 'publish_artifact', { title: 'X', content: '# x', visibility: 'bogus', workspace_id: 'wsp_acme' }))!;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('visibility must be one of');
    expect(handlePublish).not.toHaveBeenCalled();
  });

  it('refuses a non-integer limit and a missing required argument', async () => {
    const bad = (await callTool(ctx, 'list_artifacts', { limit: 'abc' }))!;
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('limit must be an integer');
    expect((await callTool(ctx, 'list_artifacts', { limit: 99 }))!.isError).toBe(true);
    expect((await callTool(ctx, 'get_artifact', {}))!.content[0].text).toContain('artifact_id is required');
    expect(handleListArtifacts).not.toHaveBeenCalled();
  });
});

describe('workspace scoping', () => {
  it('list_artifacts covers every workspace by default and narrows by id or slug', async () => {
    vi.mocked(handleListArtifacts).mockImplementation(async () => json({ artifacts: [] }));
    await callTool(ctx, 'list_artifacts', {});
    expect(new URL((vi.mocked(handleListArtifacts).mock.calls[0][0] as Request).url).searchParams.get('workspace_id')).toBeNull();
    await callTool(ctx, 'list_artifacts', { workspace_id: 'two' });
    expect(new URL((vi.mocked(handleListArtifacts).mock.calls[1][0] as Request).url).searchParams.get('workspace_id')).toBe('wsp_two');
  });

  it('search takes an optional workspace_id; a non-member workspace gets the shared error text', async () => {
    vi.mocked(quickSearch).mockResolvedValue({ artifacts: [] } as never);
    await callTool(ctx, 'search', { query: 'q3' });
    expect(vi.mocked(quickSearch).mock.calls[0][2].workspaceId).toBeUndefined();
    await callTool(ctx, 'search', { query: 'q3', workspace_id: 'acme' });
    expect(vi.mocked(quickSearch).mock.calls[1][2].workspaceId).toBe('wsp_acme');

    for (const [name, args] of [['search', { query: 'q' }], ['list_artifacts', {}], ['publish_artifact', { title: 'X', content: '# x' }]] as const) {
      const r = (await callTool(ctx, name, { ...args, workspace_id: 'wsp_other' }))!;
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain(NOT_MEMBER);
    }
    expect(handleListArtifacts).not.toHaveBeenCalled();
  });
});

describe('update_artifact', () => {
  it('renames the page through the REST PATCH and reports the new name', async () => {
    vi.mocked(handleUpdateArtifact).mockResolvedValue(json({ ok: true }));
    const r = (await callTool(ctx, 'update_artifact', { artifact_id: 'art_1', content: '# v2', title: 'Q3 report v2' }))!;
    expect(r.content[0].text).toContain('Updated "Q3 report v2"');
    const patch = vi.mocked(handleUpdateArtifact).mock.calls[0][0] as Request;
    expect(patch.method).toBe('PATCH');
    expect(await patch.json()).toEqual({ name: 'Q3 report v2' });
    expect(await sentPublish()).toMatchObject({ slug: 'q3-report', visibility: 'private', workspace_id: 'wsp_acme' });
  });

  it('says so when the rename fails instead of claiming the new name', async () => {
    vi.mocked(handleUpdateArtifact).mockResolvedValue(json({ error: 'Forbidden' }, 403));
    const r = (await callTool(ctx, 'update_artifact', { artifact_id: 'art_1', content: '# v2', title: 'New' }))!;
    expect(r.content[0].text).toContain('Updated "Q3 report"');
    expect(r.content[0].text).toContain('the name could not be changed');
  });

  it('leaves the name alone without a title', async () => {
    await callTool(ctx, 'update_artifact', { artifact_id: 'art_1', content: '# v2' });
    expect(handleUpdateArtifact).not.toHaveBeenCalled();
  });

  it('passes a change note through as the publish message, and omits it when blank', async () => {
    await callTool(ctx, 'update_artifact', { artifact_id: 'art_1', content: '# v2', message: 'Added the Q3 totals' });
    expect(await sentPublish()).toMatchObject({ message: 'Added the Q3 totals' });
    vi.mocked(handlePublish).mockClear();
    await callTool(ctx, 'update_artifact', { artifact_id: 'art_1', content: '# v3', message: '  ' });
    expect(await sentPublish()).not.toHaveProperty('message');
  });

  it('moves the page into a folder by name', async () => {
    await callTool(ctx, 'update_artifact', { artifact_id: 'art_1', content: '# v2', folder: 'reports' });
    expect(await sentPublish()).toMatchObject({ folder_id: 'fld_1' });
  });
});

describe('folders on publish', () => {
  it('files the page in a folder of the target workspace, by name or id', async () => {
    await callTool(ctx, 'publish_artifact', { title: 'A', content: '# a', workspace_id: 'wsp_acme', folder: 'Reports' });
    expect(await sentPublish()).toMatchObject({ workspace_id: 'wsp_acme', folder_id: 'fld_1' });
    vi.mocked(handlePublish).mockClear();
    await callTool(ctx, 'publish_artifact', { title: 'B', content: '# b', workspace_id: 'wsp_acme', folder: 'fld_2' });
    expect(await sentPublish()).toMatchObject({ folder_id: 'fld_2' });
  });

  it('refuses unknown or ambiguous folders without publishing', async () => {
    const missing = (await callTool(ctx, 'publish_artifact', { title: 'A', content: '# a', workspace_id: 'wsp_acme', folder: 'Nope' }))!;
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain('no folder "Nope"');
    const twice = (await callTool(ctx, 'publish_artifact', { title: 'A', content: '# a', workspace_id: 'wsp_acme', folder: 'drafts' }))!;
    expect(twice.content[0].text).toMatch(/fld_2.*fld_3|fld_3.*fld_2/);
    expect(handlePublish).not.toHaveBeenCalled();
  });
});

describe('publish note and site pages', () => {
  it('publish_artifact passes the change note to the publish handler', async () => {
    await callTool(ctx, 'publish_artifact', { title: 'A', content: '# a', workspace_id: 'wsp_acme', message: 'First cut' });
    expect(await sentPublish()).toMatchObject({ message: 'First cut' });
  });

  it('get_artifact names the live change note and links every page of a multi-page site', async () => {
    vi.mocked(handleGetArtifact).mockResolvedValue(json({
      name: 'Manual', url: 'https://shareout.test/a/manual/', visibility: 'workspace', current_version: 3,
      live_message: 'Added billing', entrypoint: 'index.html', pages: ['index.html', 'procedures/billing.html'],
    }));
    const r = (await callTool(ctx, 'get_artifact', { artifact_id: 'art_1' }))!;
    expect(r.content[0].text).toContain('What changed in this version: Added billing');
    expect(r.content[0].text).toContain('https://shareout.test/a/manual/?page=procedures/billing.html');
  });
});
