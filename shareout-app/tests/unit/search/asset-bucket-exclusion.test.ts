// @vitest-environment node
// The hidden asset-library bucket ("Workspace Assets") is an artifact row, never a page.
// It must not surface in Cmd+K / /v1/search or the agent's artifact listings (it opened
// as "Not Found" when it did). Runs against the real migrated schema.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { quickSearch } from '../../../src/search/quick-search';
import { listArtifactsForUser } from '../../../src/chat-agent/tools/artifacts';

const user = { id: 'usr_bkt', email: 'bkt@example.com' };
const WS = 'wsp_bkt';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(user.id, user.email, 'Bkt'),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'Bkt WS', 'bkt-ws', user.id),
    e.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").bind(WS, user.id),
    e.DB.prepare(`INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility)
                  VALUES ('art_page', 'Assets checklist', 'assets-checklist', ?, ?, 'workspace')`).bind(user.id, WS),
    e.DB.prepare(`INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility)
                  VALUES ('art_bucket', 'Workspace Assets', 'workspace-assets-x', ?, ?, 'workspace')`).bind(user.id, WS),
    e.DB.prepare('INSERT INTO asset_buckets (artifact_id, workspace_id, owner_id) VALUES (?, ?, ?)').bind('art_bucket', WS, user.id),
  ]);
});

describe('asset bucket is excluded from search', () => {
  it('quickSearch (Cmd+K, /v1/search) never returns it — query or recents', async () => {
    for (const workspaceId of [WS, undefined]) {
      for (const q of ['assets', 'Workspace Assets', '']) {
        const res = await quickSearch(e, user.id, { q, workspaceId, groups: ['artifacts'] });
        const ids = res.artifacts.map((h) => h.id);
        expect(ids, `${workspaceId}:${q}`).not.toContain('art_bucket');
        if (q !== 'Workspace Assets') expect(ids).toContain('art_page');
      }
    }
  });

  it('agent artifact listings skip it', async () => {
    const listed = await listArtifactsForUser(e, user.id, { limit: 50, workspaceId: WS });
    expect(listed.map((a) => a.id)).toEqual(['art_page']);
    const searched = await listArtifactsForUser(e, user.id, { limit: 50, search: 'Assets' });
    expect(searched.map((a) => a.id)).toEqual(['art_page']);
  });
});
