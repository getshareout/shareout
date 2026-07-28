import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

// PlatformEngine wraps real network calls (Snowflake/BigQuery/Sheets APIs). Tests
// must never hit those — swap in a canned responder per test instead.
let EXECUTE_IMPL: (req: {
  provider: string;
  endpoint: string;
  connectionId: string;
  params?: Record<string, unknown>;
}) => Promise<{ success: boolean; data?: unknown }> = async () => ({ success: false });

vi.mock('../../../src/data/platform', async (orig) => {
  const actual = await orig<typeof import('../../../src/data/platform')>();
  return {
    ...actual,
    PlatformEngine: class {
      execute(req: Parameters<typeof EXECUTE_IMPL>[0]) {
        return EXECUTE_IMPL(req);
      }
    },
  };
});

import { seedCatalogForConnection, recordDatasetLineage } from '../../../src/catalog/seed-resources';
import { listCatalogFiles, upsertCatalogFile } from '../../../src/catalog/store';

const e = env as unknown as Env;
const WS = 'wsp_seed_ds';

beforeAll(async () => {
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS catalog_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
  );
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`
  );
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'generic', provider TEXT NOT NULL, auth_type TEXT, config TEXT NOT NULL DEFAULT '{}', encrypted_credentials TEXT, iv TEXT, expires_at TEXT, preferred_mode TEXT NOT NULL DEFAULT 'auto', cache_ttl_seconds INTEGER NOT NULL DEFAULT 300, rate_limit_rpm INTEGER NOT NULL DEFAULT 60, is_private INTEGER NOT NULL DEFAULT 0, credential_scope TEXT NOT NULL DEFAULT 'shared', agent_query_enabled INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(scope_type, scope_id, name))`
  );
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM catalog_settings');
  await e.DB.exec('DELETE FROM workspace_files');
  await e.DB.exec('DELETE FROM connections');
  EXECUTE_IMPL = async () => ({ success: false });
});

async function insertConnection(id: string, name: string, provider: string, config?: Record<string, unknown>) {
  await e.DB.prepare(
    "INSERT INTO connections (id, scope_type, scope_id, name, kind, provider, config) VALUES (?, 'workspace', ?, ?, ?, ?, ?)"
  ).bind(id, WS, name, 'platform', provider, config ? JSON.stringify(config) : '{}').run();
}

describe('seedCatalogForConnection — Snowflake', () => {
  beforeEach(async () => {
    await insertConnection('c1', 'Snowflake Prod', 'snowflake');
  });

  function mockShowTables(names: string[]) {
    EXECUTE_IMPL = async (req) => {
      if (req.provider === 'snowflake' && req.endpoint === 'statements.execute') {
        return {
          success: true,
          data: {
            resultSetMetaData: { rowType: [{ name: 'name', type: 'text' }] },
            data: names.map((n) => [n]),
          },
        };
      }
      return { success: false };
    };
  }

  it('creates one dataset entry per table plus the connector source entry', async () => {
    mockShowTables(['orders', 'customers']);
    const res = await seedCatalogForConnection(e, WS, 'c1');
    expect(res).toEqual({ seeded: 2, skipped: 0, provider: 'snowflake' });

    const files = await listCatalogFiles(e, WS);
    expect(files.find((f) => f.path === 'sources/snowflake-prod.md')).toBeTruthy();
    const orders = files.find((f) => f.path === 'datasets/snowflake-prod/orders.md');
    expect(orders).toBeTruthy();
    expect(orders?.content).toContain('id: ds.snowflake-prod.orders');
    expect(orders?.content).toContain('upstream: [conn.snowflake-prod]');
    expect(orders?.source).toBe('seed:connector');
  });

  it('re-seeding (reconnect) does not duplicate entries', async () => {
    mockShowTables(['orders', 'customers']);
    await seedCatalogForConnection(e, WS, 'c1');
    await seedCatalogForConnection(e, WS, 'c1');
    const files = await listCatalogFiles(e, WS);
    // 1 source entry + 2 dataset entries, not 2x either.
    expect(files).toHaveLength(3);
  });

  it('never clobbers a human-edited dataset entry', async () => {
    await upsertCatalogFile(e, WS, {
      path: 'datasets/snowflake-prod/orders.md',
      content: '---\nkind: dataset\nid: ds.snowflake-prod.orders\ntitle: Orders (curated)\n---\nhand-written',
      source: 'manual',
    });
    mockShowTables(['orders', 'customers']);
    const res = await seedCatalogForConnection(e, WS, 'c1');
    expect(res.seeded).toBe(1);
    expect(res.skipped).toBe(1);
    const orders = (await listCatalogFiles(e, WS)).find((f) => f.path === 'datasets/snowflake-prod/orders.md');
    expect(orders?.content).toContain('hand-written');
    expect(orders?.source).toBe('manual');
  });

  it('resolves to an empty result (never throws) when the provider call fails', async () => {
    EXECUTE_IMPL = async () => ({ success: false });
    const res = await seedCatalogForConnection(e, WS, 'c1');
    expect(res.seeded).toBe(0);
    // Source entry still gets seeded even though the table listing failed.
    const files = await listCatalogFiles(e, WS);
    expect(files.find((f) => f.path === 'sources/snowflake-prod.md')).toBeTruthy();
  });
});

describe('seedCatalogForConnection — BigQuery', () => {
  it('walks datasets.list then tables.list', async () => {
    await insertConnection('c2', 'BQ Warehouse', 'bigquery', { projectId: 'proj-1' });
    EXECUTE_IMPL = async (req) => {
      if (req.provider === 'bigquery' && req.endpoint === 'datasets.list') {
        return { success: true, data: { datasets: [{ datasetReference: { datasetId: 'analytics' } }] } };
      }
      if (req.provider === 'bigquery' && req.endpoint === 'tables.list') {
        return {
          success: true,
          data: { tables: [{ tableReference: { tableId: 'events' } }, { tableReference: { tableId: 'users' } }] },
        };
      }
      return { success: false };
    };
    const res = await seedCatalogForConnection(e, WS, 'c2');
    expect(res).toEqual({ seeded: 2, skipped: 0, provider: 'bigquery' });
    const files = await listCatalogFiles(e, WS);
    // Resource "analytics.events" slugifies to analytics-events; title keeps the FQN.
    const entry = files.find((f) => f.path === 'datasets/bq-warehouse/analytics-events.md');
    expect(entry).toBeTruthy();
    expect(entry?.content).toContain('title: analytics.events');
  });

  it('skips (no API call needed) when the connection has no projectId', async () => {
    await insertConnection('c3', 'BQ No Project', 'bigquery', {});
    const called: string[] = [];
    EXECUTE_IMPL = async (req) => { called.push(req.endpoint); return { success: false }; };
    const res = await seedCatalogForConnection(e, WS, 'c3');
    expect(res.seeded).toBe(0);
    expect(called).toHaveLength(0);
  });
});

describe('seedCatalogForConnection — Google Sheets', () => {
  it('seeds one dataset entry per tab', async () => {
    await insertConnection('c4', 'Revenue Sheet', 'google-sheets', { spreadsheetId: 'ssid1' });
    EXECUTE_IMPL = async (req) => {
      if (req.provider === 'google-sheets' && req.endpoint === 'spreadsheets.get') {
        return { success: true, data: { sheets: [{ properties: { title: 'Q1' } }, { properties: { title: 'Q2' } }] } };
      }
      return { success: false };
    };
    const res = await seedCatalogForConnection(e, WS, 'c4');
    expect(res).toEqual({ seeded: 2, skipped: 0, provider: 'google-sheets' });
  });
});

describe('seedCatalogForConnection — unsupported provider', () => {
  it('skips resource listing for providers without a cheap schema-browse call (e.g. shopify)', async () => {
    await insertConnection('c5', 'Store', 'shopify');
    const res = await seedCatalogForConnection(e, WS, 'c5');
    expect(res).toEqual({ seeded: 0, skipped: 0, provider: 'shopify' });
    // Source entry (kind: source) is still seeded — only per-resource dataset
    // enumeration is skipped.
    const files = await listCatalogFiles(e, WS);
    expect(files.find((f) => f.path === 'sources/store.md')).toBeTruthy();
  });

  it('resolves to an empty result for an unknown connection id', async () => {
    const res = await seedCatalogForConnection(e, WS, 'nope');
    expect(res).toEqual({ seeded: 0, skipped: 0, provider: null });
  });
});

describe('recordDatasetLineage', () => {
  it('creates a dataset entry with connection upstream + artifact provenance', async () => {
    await recordDatasetLineage(e, WS, 'Snowflake Prod', 'sales', 'art_123');
    const files = await listCatalogFiles(e, WS);
    const entry = files.find((f) => f.path === 'datasets/snowflake-prod/sales.md');
    expect(entry).toBeTruthy();
    expect(entry?.content).toContain('id: ds.snowflake-prod.sales');
    expect(entry?.content).toContain('upstream: [conn.snowflake-prod]');
    expect(entry?.content).toContain('artifact: art_123');
    expect(entry?.source).toBe('seed:provenance');
  });

  it('is idempotent — re-materializing the same dataset does not duplicate', async () => {
    await recordDatasetLineage(e, WS, 'Snowflake Prod', 'sales', 'art_123');
    await recordDatasetLineage(e, WS, 'Snowflake Prod', 'sales', 'art_123');
    const files = await listCatalogFiles(e, WS);
    expect(files.filter((f) => f.path === 'datasets/snowflake-prod/sales.md')).toHaveLength(1);
  });

  it('never overwrites a human-edited dataset entry', async () => {
    await upsertCatalogFile(e, WS, {
      path: 'datasets/snowflake-prod/sales.md',
      content: '---\nkind: dataset\nid: ds.snowflake-prod.sales\ntitle: Sales (curated)\n---\nhand-written',
      source: 'manual',
    });
    await recordDatasetLineage(e, WS, 'Snowflake Prod', 'sales', 'art_123');
    const entry = (await listCatalogFiles(e, WS)).find((f) => f.path === 'datasets/snowflake-prod/sales.md');
    expect(entry?.content).toContain('hand-written');
    expect(entry?.source).toBe('manual');
  });
});
