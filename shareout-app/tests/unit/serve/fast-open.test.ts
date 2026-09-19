// First-open hot path against real Miniflare D1 + KV: route records resolve in one
// lookup, cache writes leave the response path, publish/visibility purges reach the
// merged keys, and nested folder URLs verify in one query.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import {
  contentRouteKey,
  invalidateDeploymentCache,
  invalidateDeploymentCacheById,
  resolveRoutedDeployment,
  workspaceRouteKey,
} from '../../../src/serve/deployment-cache';
import { resolveSubdomainRoute } from '../../../src/subdomain';
import { verifyFolderPath } from '../../../src/serve/namespaced';

const e = env as unknown as Env;
const WS_KEY = workspaceRouteKey('acme', 'report');
const CDN_KEY = contentRouteKey('art_1');

function ctx() {
  const pending: Promise<unknown>[] = [];
  const waitUntil = vi.fn((p: Promise<unknown>) => void pending.push(p));
  return { ctx: { waitUntil } as unknown as ExecutionContext, waitUntil, flush: () => Promise.all(pending) };
}

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, slug TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, description TEXT, visibility TEXT, auth_method TEXT, owner_id TEXT, workspace_id TEXT, paused INTEGER DEFAULT 0, artifact_type TEXT, type_metadata TEXT, access_policy TEXT, display_slug TEXT, folder_id TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, artifact_id TEXT, entrypoint TEXT, mobile_entrypoint TEXT, manifest_json TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS deployments (id TEXT PRIMARY KEY, artifact_id TEXT, version_id TEXT, channel TEXT, slug TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, version_id TEXT, path TEXT, r2_key TEXT, mime TEXT, size_bytes INTEGER)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT, held_visibility TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifact_presentation (artifact_id TEXT PRIMARY KEY, social_title TEXT, social_description TEXT, social_image_url TEXT, thumbnail_ext TEXT, has_mobile INTEGER, pwa_config TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, slug TEXT, parent_id TEXT)`);
});

beforeEach(async () => {
  for (const t of ['workspaces', 'artifacts', 'versions', 'deployments', 'assets', 'artifact_moderation', 'artifact_presentation', 'folders']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  await e.SLUGS.delete(WS_KEY);
  await e.SLUGS.delete(CDN_KEY);
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO workspaces (id, slug) VALUES ('ws_1', 'acme')`),
    e.DB.prepare(`INSERT INTO artifacts (id, name, visibility, auth_method, owner_id, workspace_id, artifact_type, display_slug) VALUES ('art_1', 'Report', 'public', 'google', 'usr_1', 'ws_1', 'html', 'report')`),
    e.DB.prepare(`INSERT INTO versions (id, artifact_id, entrypoint, mobile_entrypoint) VALUES ('ver_1', 'art_1', 'index.html', 'm.html')`),
    e.DB.prepare(`INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_1', 'art_1', 'ver_1', 'production', 'report-x1')`),
    e.DB.prepare(`INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes) VALUES ('a1', 'ver_1', 'index.html', 'k/v1/index.html', 'text/html', 10), ('a2', 'ver_1', 'm.html', 'k/v1/m.html', 'text/html', 5)`),
    e.DB.prepare(`INSERT INTO artifact_presentation (artifact_id, has_mobile) VALUES ('art_1', 1)`),
  ]);
});

async function republishToV2() {
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO versions (id, artifact_id, entrypoint) VALUES ('ver_2', 'art_1', 'index.html')`),
    e.DB.prepare(`INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes) VALUES ('a3', 'ver_2', 'index.html', 'k/v2/index.html', 'text/html', 11)`),
    e.DB.prepare(`UPDATE deployments SET version_id = 'ver_2' WHERE artifact_id = 'art_1'`),
  ]);
}

const byWorkspace = (c?: ExecutionContext) => resolveRoutedDeployment(
  e, WS_KEY, 'a.workspace_id = (SELECT id FROM workspaces WHERE slug = ?) AND a.display_slug = ?', ['acme', 'report'], c,
);
const byArtifact = (c?: ExecutionContext) => resolveRoutedDeployment(e, CDN_KEY, 'd.artifact_id = ?', ['art_1'], c);

describe('route record lookup (real D1 + KV)', () => {
  it('resolves the shorthand to the full record in one query, then serves the next open from one KV read', async () => {
    const prepare = vi.spyOn(e.DB, 'prepare');
    const { ctx: c, waitUntil, flush } = ctx();

    const cold = await byWorkspace(c);
    expect(cold).toMatchObject({
      slug: 'report-x1',
      record: {
        version_id: 'ver_1',
        visibility: 'public',
        moderation_status: 'approved',
        entry_asset: { r2_key: 'k/v1/index.html', mime: 'text/html', size_bytes: 10 },
        mobile_entry_asset: { r2_key: 'k/v1/m.html', mime: 'text/html', size_bytes: 5 },
      },
    });
    expect(prepare).toHaveBeenCalledTimes(2); // combined row + mobile entry row
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await flush();

    prepare.mockClear();
    const warm = await byWorkspace(c);
    expect(warm).toEqual(cold);
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();
  });

  it('resolves the content-domain key by artifact id', async () => {
    const { ctx: c, flush } = ctx();
    expect((await byArtifact(c))?.slug).toBe('report-x1');
    await flush();
    expect(await e.SLUGS.get(CDN_KEY, 'json')).toMatchObject({ slug: 'report-x1' });
  });

  it('returns null (and caches nothing) when the artifact has no production deployment', async () => {
    await e.DB.exec(`DELETE FROM deployments`);
    expect(await byWorkspace()).toBeNull();
    expect(await e.SLUGS.get(WS_KEY)).toBeNull();
  });

  it('subdomain shorthand rewrites to the deploy slug with the record attached', async () => {
    const route = await resolveSubdomainRoute(new Request('https://acme.example.com/report/'), e, 'acme', '/report/');
    expect(route.rewritePath).toBe('/a/report-x1/');
    expect(route.deployment?.record.version_id).toBe('ver_1');
  });
});

describe('merged route keys are purged with the deployment cache', () => {
  it('republish purges wsslug: and cdnslug:, so the next open serves the new version', async () => {
    const { ctx: c, flush } = ctx();
    await byWorkspace(c);
    await byArtifact(c);
    await flush();
    expect(await e.SLUGS.get(WS_KEY)).not.toBeNull();
    expect(await e.SLUGS.get(CDN_KEY)).not.toBeNull();

    await republishToV2();
    await invalidateDeploymentCache(e, 'report-x1', 'art_1');

    expect(await e.SLUGS.get(WS_KEY)).toBeNull();
    expect(await e.SLUGS.get(CDN_KEY)).toBeNull();
    expect((await byWorkspace())?.record.entry_asset?.r2_key).toBe('k/v2/index.html');
    expect((await byArtifact())?.record.entry_asset?.r2_key).toBe('k/v2/index.html');
  });

  it('a visibility change (purge by id) drops the stale public record', async () => {
    const { ctx: c, flush } = ctx();
    await byWorkspace(c);
    await byArtifact(c);
    await flush();

    await e.DB.exec(`UPDATE artifacts SET visibility = 'private' WHERE id = 'art_1'`);
    await invalidateDeploymentCacheById(e, 'art_1');

    expect((await byWorkspace())?.record.visibility).toBe('private');
    expect((await byArtifact())?.record.visibility).toBe('private');
  });

  it('purges precomputed route keys when the artifact row is already gone (hard delete)', async () => {
    const { ctx: c, flush } = ctx();
    await byWorkspace(c);
    await flush();

    await e.DB.exec(`DELETE FROM artifacts`);
    await invalidateDeploymentCache(e, 'report-x1', 'art_1', [WS_KEY, CDN_KEY]);
    expect(await e.SLUGS.get(WS_KEY)).toBeNull();
  });
});

describe('verifyFolderPath', () => {
  beforeEach(async () => {
    await e.DB.batch([
      e.DB.prepare(`INSERT INTO folders (id, slug, parent_id) VALUES ('f1', 'reports', NULL), ('f2', '2026', 'f1'), ('f3', 'q1', 'f2')`),
      e.DB.prepare(`UPDATE artifacts SET folder_id = 'f3' WHERE id = 'art_1'`),
    ]);
  });

  it('matches a three-level folder path with a single query', async () => {
    const prepare = vi.spyOn(e.DB, 'prepare');
    expect(await verifyFolderPath(e, 'art_1', 'reports/2026/q1')).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(1);
    prepare.mockRestore();
  });

  it('rejects a partial or wrong path', async () => {
    expect(await verifyFolderPath(e, 'art_1', 'reports/2026')).toBe(false);
    expect(await verifyFolderPath(e, 'art_1', 'reports/2025/q1')).toBe(false);
  });

  it('rejects a folder path for an artifact at the workspace root', async () => {
    await e.DB.exec(`UPDATE artifacts SET folder_id = NULL WHERE id = 'art_1'`);
    expect(await verifyFolderPath(e, 'art_1', 'reports')).toBe(false);
  });
});
