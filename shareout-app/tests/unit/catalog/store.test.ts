import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import {
  isCatalogEnabled,
  setCatalogEnabled,
  upsertCatalogFile,
  deleteCatalogFile,
  listCatalogFiles,
  loadCatalog,
  seedConnectorsAsSources,
  buildConnectorEntry,
  slugifyName,
} from '../../../src/catalog';

const WS = 'wsp_cat';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_cat_owner', 'owner@agencia.example', 'Olga')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Agencia', 'agencia-cat', 'usr_cat_owner')").bind(WS),
  ]);
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM catalog_metrics');
  await e.DB.exec('DELETE FROM catalog_settings');
  await e.DB.exec('DELETE FROM workspace_files');
  await e.DB.exec('DELETE FROM connections');
});

describe('catalog settings', () => {
  it('defaults to disabled and toggles', async () => {
    expect(await isCatalogEnabled(e, WS)).toBe(false);
    await setCatalogEnabled(e, WS, true);
    expect(await isCatalogEnabled(e, WS)).toBe(true);
    await setCatalogEnabled(e, WS, false);
    expect(await isCatalogEnabled(e, WS)).toBe(false);
  });
});

describe('catalog files CRUD', () => {
  it('upserts, lists, and deletes files', async () => {
    await upsertCatalogFile(e, WS, { path: 'a.md', content: '---\nkind: table\nid: a\ntitle: A\n---' });
    await upsertCatalogFile(e, WS, { path: 'a.md', content: '---\nkind: view\nid: a\ntitle: A2\n---' });
    let files = await listCatalogFiles(e, WS);
    expect(files).toHaveLength(1);
    expect(files[0].content).toContain('A2');
    expect(files[0].source).toBe('manual');
    expect(files[0]).toMatchObject({ updatedBy: null, updatedByKind: 'agent' });

    await deleteCatalogFile(e, WS, 'a.md');
    files = await listCatalogFiles(e, WS);
    expect(files).toHaveLength(0);
  });

  it('records who wrote a file, and whether a person or an agent did', async () => {
    await upsertCatalogFile(e, WS, { path: 'a.md', content: 'x', updatedBy: 'usr_ana', updatedByKind: 'user' });
    expect((await listCatalogFiles(e, WS))[0]).toMatchObject({ updatedBy: 'usr_ana', updatedByKind: 'user' });
    await upsertCatalogFile(e, WS, { path: 'a.md', content: 'y', updatedBy: 'usr_bot', updatedByKind: 'agent' });
    expect((await listCatalogFiles(e, WS))[0]).toMatchObject({ content: 'y', updatedBy: 'usr_bot', updatedByKind: 'agent' });
    await upsertCatalogFile(e, WS, { path: 'a.md', content: 'z', source: 'seed:connector' });
    expect((await listCatalogFiles(e, WS))[0]).toMatchObject({ updatedBy: null, updatedByKind: 'agent', source: 'seed:connector' });
  });

  it('loadCatalog parses stored files through the engine', async () => {
    await upsertCatalogFile(e, WS, {
      path: 'chat.md',
      content: '---\nkind: source\nid: s1\ntitle: Chat\ntags: [tier.silver]\n---\nbody',
    });
    const { entries, issues } = await loadCatalog(e, WS);
    expect(issues).toHaveLength(0);
    expect(entries[0]).toMatchObject({ id: 's1', kind: 'source', tags: ['tier.silver'] });
  });
});

describe('slugifyName + buildConnectorEntry', () => {
  it('slugifies messy names', () => {
    expect(slugifyName('Snowflake Prod!')).toBe('snowflake-prod');
    expect(slugifyName('   ')).toBe('connection');
  });

  it('builds a source entry keyed by connection id, keeping the name slug as an alias', async () => {
    const { path, content } = buildConnectorEntry({
      id: 'conn_7f2',
      name: 'Snowflake Prod',
      kind: 'warehouse',
      provider: 'snowflake',
    });
    expect(path).toBe('sources/conn_7f2.md');
    await upsertCatalogFile(e, WS, { path, content, source: 'seed:connector' });
    const { entries, issues } = await loadCatalog(e, WS);
    expect(issues).toHaveLength(0);
    expect(entries[0]).toMatchObject({
      kind: 'source',
      id: 'conn.conn_7f2',
      aliases: ['conn.snowflake-prod'],
      connection: 'Snowflake Prod',
      connectionId: 'conn_7f2',
      status: 'draft',
    });
    expect(entries[0].tags).toContain('provider.snowflake');
  });

  it('quotes names YAML would misread (an agency names connections "Meta Ads: Cliente")', async () => {
    for (const name of ['Meta Ads: Cliente Norte', 'Ventas #2', 'true', '2026', "O'Brien [ads]"]) {
      const { path, content } = buildConnectorEntry({ id: 'conn_q', name, kind: 'platform', provider: 'facebook-ads' });
      await upsertCatalogFile(e, WS, { path, content });
      const { entries, issues } = await loadCatalog(e, WS);
      expect(issues, name).toHaveLength(0);
      expect(entries[0]).toMatchObject({ title: name, connection: name });
    }
  });
});

describe('seedConnectorsAsSources', () => {
  beforeEach(async () => {
    await e.DB.prepare(
      "INSERT INTO connections (id, scope_type, scope_id, name, kind, provider) VALUES (?, 'workspace', ?, ?, ?, ?)"
    )
      .bind('c1', WS, 'Snowflake Prod', 'platform', 'snowflake')
      .run();
    await e.DB.prepare(
      "INSERT INTO connections (id, scope_type, scope_id, name, kind, provider) VALUES (?, 'workspace', ?, ?, ?, ?)"
    )
      .bind('c2', WS, 'Shopify', 'platform', 'shopify')
      .run();
  });

  it('seeds one source entry per connector, keyed by connection id', async () => {
    const res = await seedConnectorsAsSources(e, WS);
    expect(res).toEqual({ seeded: 2, skipped: 0 });
    const files = await listCatalogFiles(e, WS);
    expect(files.map(f => f.path).sort()).toEqual(['sources/c1.md', 'sources/c2.md']);
    expect(files.every(f => f.source === 'seed:connector')).toBe(true);
  });

  it('replaces a name-keyed seed from before, so the connector is not listed twice', async () => {
    await upsertCatalogFile(e, WS, {
      path: 'sources/snowflake-prod.md',
      content: '---\nkind: source\nid: conn.snowflake-prod\ntitle: Snowflake Prod\n---',
      source: 'seed:connector',
    });
    await seedConnectorsAsSources(e, WS);
    const { entries, issues } = await loadCatalog(e, WS);
    expect(issues).toHaveLength(0);
    expect(entries.map(x => x.id).sort()).toEqual(['conn.c1', 'conn.c2']);
  });

  it('never clobbers a manually edited file, at the old name-keyed path or the new one', async () => {
    await upsertCatalogFile(e, WS, {
      path: 'sources/snowflake-prod.md',
      content: '---\nkind: source\nid: conn.snowflake-prod\ntitle: Hand Tuned\n---\nmine',
      source: 'manual',
    });
    await upsertCatalogFile(e, WS, {
      path: 'sources/c2.md',
      content: '---\nkind: source\nid: conn.c2\ntitle: Shopify (curated)\n---\nmine too',
      source: 'manual',
    });
    const res = await seedConnectorsAsSources(e, WS);
    expect(res).toEqual({ seeded: 0, skipped: 2 });
    const files = await listCatalogFiles(e, WS);
    expect(files.map(f => f.path).sort()).toEqual(['sources/c2.md', 'sources/snowflake-prod.md']);
    expect(files.every(f => f.source === 'manual')).toBe(true);
  });

  it('re-seeding overwrites prior seed entries without duplicating', async () => {
    await seedConnectorsAsSources(e, WS);
    await seedConnectorsAsSources(e, WS);
    expect(await listCatalogFiles(e, WS)).toHaveLength(2);
  });
});
