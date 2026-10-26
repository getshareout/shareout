import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/chat-agent/scope', async (orig) => ({
  ...(await orig<typeof import('../../../src/chat-agent/scope')>()),
  scopedWorkspaceId: async (c: { selectedWorkspaceId?: string | null }) => (c.selectedWorkspaceId === 'wsp_tools' ? 'wsp_tools' : null),
}));
import { applyMigrations, e } from '../helpers/migrated-db';
import type { ToolContext } from '../../../src/chat-agent/tools/types';
import { catalogSearchTool, catalogGetTool } from '../../../src/chat-agent/tools/catalog';
import { certificationHash, recordCertification, setCatalogEnabled, upsertCatalogFile } from '../../../src/catalog';

const WS = 'wsp_tools';
const ADMIN = 'usr_tools_admin';

function ctx(workspaceId: string | null): ToolContext {
  return { env: e, selectedWorkspaceId: workspaceId, userId: 'u1' } as unknown as ToolContext;
}

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'ana@agencia.example', 'Ana Gómez')").bind(ADMIN),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Agencia', 'agencia-tools', ?)").bind(WS, ADMIN),
  ]);
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM catalog_certifications');
  await e.DB.exec('DELETE FROM catalog_settings');
  await e.DB.exec('DELETE FROM workspace_files');
});

// The file claims `status: certified` — a claim the tools must not pass on as trust.
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

async function certifySource(note: string | null = null) {
  await recordCertification(e, {
    workspaceId: WS,
    entryId: 'events_silver.chat_sent',
    contentHash: await certificationHash('source', SOURCE),
    decision: 'certified',
    note,
    decidedBy: ADMIN,
  });
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

  it('reports the effective status: a file saying certified is a draft until an admin certifies it', async () => {
    await seed();
    expect((await catalogSearchTool.execute(ctx(WS), { status: 'certified' })).count).toBe(0);
    await certifySource();
    const certified = await catalogSearchTool.execute(ctx(WS), { status: 'certified' });
    expect(certified.count).toBe(1);
    expect(certified.entries[0]).toMatchObject({ status: 'certified', certified_by: 'Ana Gómez', certified_at: expect.any(String) });
  });
});

describe('catalog_get tool', () => {
  it('returns the entry body plus full lineage', async () => {
    await seed();
    const r = await catalogGetTool.execute(ctx(WS), { id: 'events_silver.chat_sent' });
    expect(r.entry).toMatchObject({ id: 'events_silver.chat_sent', status: 'draft' });
    expect(r.entry.certified_by).toBeUndefined();
    expect(r.entry.body).toContain('External chat event source');
    expect(r.downstreamAll).toContain('art.daily_metrics');
  });

  it('cites who certified it, and flags an edit made after that', async () => {
    await seed();
    await certifySource('Checked against the warehouse');
    const ok = await catalogGetTool.execute(ctx(WS), { id: 'events_silver.chat_sent' });
    expect(ok.entry).toMatchObject({ status: 'certified', certified_by: 'Ana Gómez', certification_note: 'Checked against the warehouse' });

    await upsertCatalogFile(e, WS, { path: 'chat.md', content: SOURCE.replace('External', 'Edited external') });
    const edited = await catalogGetTool.execute(ctx(WS), { id: 'events_silver.chat_sent' });
    expect(edited.entry).toMatchObject({ status: 'draft', changed_since_certification: true });
    expect(edited.entry.certified_by).toBeUndefined();
  });

  it('errors on unknown id', async () => {
    await seed();
    const r = await catalogGetTool.execute(ctx(WS), { id: 'nope' });
    expect(r).toHaveProperty('error');
  });
});
