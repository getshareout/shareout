import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../../src/types';
import type { ToolContext } from '../../../src/chat-agent/tools/types';
import { catalogSearchTool, catalogGetTool } from '../../../src/chat-agent/tools/catalog';
import { setCatalogEnabled, upsertCatalogFile } from '../../../src/catalog';

const e = env as unknown as Env;
const WS = 'wsp_tools';

function ctx(workspaceId: string | null): ToolContext {
  return { env: e, selectedWorkspaceId: workspaceId, userId: 'u1' } as unknown as ToolContext;
}

beforeAll(async () => {
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS catalog_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
  );
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`
  );
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM catalog_settings');
  await e.DB.exec('DELETE FROM workspace_files');
});

const SOURCE = `---
kind: source
id: events_silver.chat_sent
title: Chat Sent
status: certified
fqn: analytics-platform.events_silver.chat_sent
downstream: [art.daily_metrics]
---
External chat event source.`;

const DATASET = `---
kind: dataset
id: art.daily_metrics
title: Daily Metrics
status: draft
upstream: [events_silver.chat_sent]
---
Built from chat_sent.`;

async function seed() {
  await setCatalogEnabled(e, WS, true);
  await upsertCatalogFile(e, WS, { path: 'chat.md', content: SOURCE });
  await upsertCatalogFile(e, WS, { path: 'daily.md', content: DATASET });
}

describe('catalog_search tool', () => {
  it('reports no catalog when disabled', async () => {
    const r = await catalogSearchTool.execute(ctx(WS), {});
    expect(r).toMatchObject({ enabled: false });
  });

  it('requires a workspace', async () => {
    const r = await catalogSearchTool.execute(ctx(null), {});
    expect(r).toHaveProperty('error');
  });

  it('searches enabled catalog and filters by kind', async () => {
    await seed();
    const all = await catalogSearchTool.execute(ctx(WS), {});
    expect(all).toMatchObject({ enabled: true, count: 2 });
    const sources = await catalogSearchTool.execute(ctx(WS), { kind: 'source' });
    expect(sources.count).toBe(1);
    expect(sources.entries[0]).toMatchObject({ id: 'events_silver.chat_sent', fqn: expect.any(String) });
  });
});

describe('catalog_get tool', () => {
  it('returns the entry body plus full lineage', async () => {
    await seed();
    const r = await catalogGetTool.execute(ctx(WS), { id: 'events_silver.chat_sent' });
    expect(r.entry).toMatchObject({ id: 'events_silver.chat_sent', status: 'certified' });
    expect(r.entry.body).toContain('External chat event source');
    expect(r.downstreamAll).toContain('art.daily_metrics');
  });

  it('errors on unknown id', async () => {
    await seed();
    const r = await catalogGetTool.execute(ctx(WS), { id: 'nope' });
    expect(r).toHaveProperty('error');
  });
});
