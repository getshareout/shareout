import type { Env } from '../types';
import { listCatalogFiles, upsertCatalogFile } from './store';

interface ConnectionRow {
  name: string;
  kind: string;
  provider: string;
}

export function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'connection'
  );
}

export function buildConnectorEntry(conn: ConnectionRow): { path: string; content: string } {
  const slug = slugifyName(conn.name);
  const tags = [`provider.${slugifyName(conn.provider)}`, `kind.${slugifyName(conn.kind)}`];
  const content = `---
kind: source
id: conn.${slug}
title: ${conn.name}
status: draft
connection: ${conn.name}
tags: [${tags.join(', ')}]
---

Auto-seeded from the workspace connector **${conn.name}** (${conn.provider}). Agents can
enrich this entry with \`fqn\`, \`domain\`, \`owner\`, lineage, and prose.
`;
  return { path: `sources/${slug}.md`, content };
}

export interface SeedResult {
  seeded: number;
  skipped: number;
}

// Auto-seed `kind: source` catalog entries from the workspace's existing connectors.
// Never clobbers files a human/agent has edited (source === 'manual').
export async function seedConnectorsAsSources(env: Env, workspaceId: string): Promise<SeedResult> {
  const existing = new Map(
    (await listCatalogFiles(env, workspaceId)).map(f => [f.path, f.source])
  );

  const rows = await env.DB.prepare(
    "SELECT name, kind, provider FROM connections WHERE scope_type = 'workspace' AND scope_id = ?"
  )
    .bind(workspaceId)
    .all<ConnectionRow>();

  let seeded = 0;
  let skipped = 0;
  for (const conn of rows.results) {
    const entry = buildConnectorEntry(conn);
    if (existing.get(entry.path) === 'manual') {
      skipped += 1;
      continue;
    }
    await upsertCatalogFile(env, workspaceId, { ...entry, source: 'seed:connector' });
    seeded += 1;
  }
  return { seeded, skipped };
}
