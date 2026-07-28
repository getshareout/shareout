// File usage graph (work/042 P4). Real Miniflare D1 + R2: scan a version's source for
// deliverable refs, populate file_artifact_usage, read it back.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../../src/types';
import { scanFileUsage, listFileUsage } from '../../../src/assets/usage';

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, display_slug TEXT, deleted_at TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, entrypoint TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS assets (version_id TEXT, path TEXT, r2_key TEXT, mime TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, name TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS file_artifact_usage (deliverable_id TEXT, artifact_id TEXT, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (deliverable_id, artifact_id))`);
});

beforeEach(async () => {
  for (const t of ['artifacts', 'versions', 'assets', 'asset_deliverables', 'file_artifact_usage']) await e.DB.exec(`DELETE FROM ${t}`);
  await e.DB.exec(`INSERT INTO artifacts (id, name, slug) VALUES ('art1','Dashboard','dash')`);
  // dReal + dReal2 exist; dGhost is referenced in source but is NOT a real deliverable.
  await e.DB.exec(`INSERT INTO asset_deliverables (id, name) VALUES ('dlv_real1','A'),('dlv_real2','B')`);
});

async function putVersion(vid: string, html: string) {
  await e.DB.exec(`INSERT INTO versions (id, entrypoint) VALUES ('${vid}','index.html')`);
  await e.DB.exec(`INSERT INTO assets (version_id, path, r2_key, mime) VALUES ('${vid}','index.html','k/${vid}','text/html')`);
  await e.ARTIFACTS.put('k/' + vid, new TextEncoder().encode(html));
}

describe('scanFileUsage (work/042 P4)', () => {
  it('records real deliverable refs (getUrl + content URL), ignores ghosts', async () => {
    await putVersion('v1', `<script>img.src = so.files.getUrl('dlv_real1'); fetch('/v1/files/dlv_real2/content'); var x='dlv_ghost';</script>`);
    await scanFileUsage(e, 'art1', 'v1');
    expect((await listFileUsage(e, 'dlv_real1')).map(u => u.artifactId)).toEqual(['art1']);
    expect((await listFileUsage(e, 'dlv_real2')).map(u => u.artifactId)).toEqual(['art1']);
    expect(await listFileUsage(e, 'dlv_ghost')).toEqual([]); // not a real deliverable → dropped
  });

  it('re-scan replaces prior rows (a removed reference disappears)', async () => {
    await putVersion('v1', `so.files.getUrl('dlv_real1'); so.files.getUrl('dlv_real2');`);
    await scanFileUsage(e, 'art1', 'v1');
    expect((await listFileUsage(e, 'dlv_real1')).length).toBe(1);
    await putVersion('v2', `so.files.getUrl('dlv_real2');`); // real1 dropped
    await scanFileUsage(e, 'art1', 'v2');
    expect(await listFileUsage(e, 'dlv_real1')).toEqual([]);
    expect((await listFileUsage(e, 'dlv_real2')).map(u => u.artifactId)).toEqual(['art1']);
  });

  it('listFileUsage returns the artifact name + slug', async () => {
    await putVersion('v1', `so.files.getUrl('dlv_real1');`);
    await scanFileUsage(e, 'art1', 'v1');
    const u = await listFileUsage(e, 'dlv_real1');
    expect(u[0]).toMatchObject({ artifactId: 'art1', name: 'Dashboard', slug: 'dash' });
  });
});
