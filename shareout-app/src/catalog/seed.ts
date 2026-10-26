import type { Env } from '../types';
import { deleteCatalogFile, listCatalogFiles, upsertCatalogFile, type CatalogFileSource } from './store';
import { slugify } from '../slugify';

export interface ConnectionRow {
  id: string;
  name: string;
  kind: string;
  provider: string;
}

export function slugifyName(name: string): string {
  return slugify(name) || 'connection';
}

// A connector's `source` entry is keyed by the connection id, so renaming the connection
// never breaks a link to it. Before that it was keyed by the name's slug; that id stays
// on the entry as an alias, so lineage and links written against it keep resolving.
export const connectorEntryId = (connectionId: string) => `conn.${connectionId}`;
export const connectorEntryPath = (connectionId: string) => `sources/${connectionId}.md`;
export const legacyConnectorEntryId = (name: string) => `conn.${slugifyName(name)}`;
export const legacyConnectorEntryPath = (name: string) => `sources/${slugifyName(name)}.md`;

const YAML_RESERVED = /^(true|false|yes|no|on|off|null|~)$/i;

/** A YAML scalar for a free-text value: plain when that is safe, double-quoted otherwise. */
export function yamlString(value: string): string {
  const plain = /^[\p{L}\p{N}_][\p{L}\p{N}_ .\-/()@&+]*$/u.test(value) && !/\s$/.test(value);
  return plain && !YAML_RESERVED.test(value) && Number.isNaN(Number(value)) ? value : JSON.stringify(value);
}

export function buildConnectorEntry(conn: ConnectionRow): { path: string; content: string } {
  const tags = [`provider.${slugifyName(conn.provider)}`, `kind.${slugifyName(conn.kind)}`];
  const content = `---
kind: source
id: ${connectorEntryId(conn.id)}
title: ${yamlString(conn.name)}
status: draft
connection: ${yamlString(conn.name)}
connection_id: ${conn.id}
aliases: [${legacyConnectorEntryId(conn.name)}]
tags: [${tags.join(', ')}]
---

Auto-seeded from the workspace connector **${conn.name}** (${conn.provider}). Agents can
enrich this entry with \`fqn\`, \`domain\`, \`owner\`, lineage, and prose.
`;
  return { path: connectorEntryPath(conn.id), content };
}

/**
 * The id lineage should point at for a connection's `source` entry: the connection-id
 * entry, unless a hand-edited entry at the old name-keyed path is standing in for it.
 */
export function connectorSourceId(
  conn: Pick<ConnectionRow, 'id' | 'name'>,
  sources: Map<string, CatalogFileSource>
): string {
  const handEditedLegacy =
    sources.get(connectorEntryPath(conn.id)) !== 'manual' && sources.get(legacyConnectorEntryPath(conn.name)) === 'manual';
  return handEditedLegacy ? legacyConnectorEntryId(conn.name) : connectorEntryId(conn.id);
}

/**
 * Write one connector's `source` entry at its connection-id path and retire the seeded
 * name-keyed file it replaces. A hand-edited file at either path wins: nothing is written.
 */
export async function writeConnectorEntry(
  env: Env,
  workspaceId: string,
  conn: ConnectionRow,
  existing: Map<string, CatalogFileSource>
): Promise<'seeded' | 'skipped'> {
  const entry = buildConnectorEntry(conn);
  const legacy = legacyConnectorEntryPath(conn.name);
  if (existing.get(entry.path) === 'manual' || existing.get(legacy) === 'manual') return 'skipped';
  if (legacy !== entry.path && existing.has(legacy)) {
    await deleteCatalogFile(env, workspaceId, legacy);
    existing.delete(legacy);
  }
  await upsertCatalogFile(env, workspaceId, { ...entry, source: 'seed:connector' });
  existing.set(entry.path, 'seed:connector');
  return 'seeded';
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
    "SELECT id, name, kind, provider FROM connections WHERE scope_type = 'workspace' AND scope_id = ?"
  )
    .bind(workspaceId)
    .all<ConnectionRow>();

  let seeded = 0;
  let skipped = 0;
  for (const conn of rows.results) {
    if ((await writeConnectorEntry(env, workspaceId, conn, existing)) === 'seeded') seeded += 1;
    else skipped += 1;
  }
  return { seeded, skipped };
}
