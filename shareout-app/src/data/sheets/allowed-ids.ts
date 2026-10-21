import type { Env } from '../../types';

const ID_TOKEN = /[A-Za-z0-9_-]{30,60}/g;
const MAX_ASSETS = 50;
const MAX_ASSET_BYTES = 2_000_000;
const MAX_CACHED = 200;

const cache = new Map<string, Set<string>>();

const isText = (mime: string) =>
  mime.startsWith('text/') || mime.includes('javascript') || mime.includes('json') || mime.includes('xml');

async function sourceIds(env: Env, artifactId: string): Promise<Set<string>> {
  const dep = await env.DB.prepare(
    "SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = 'production'"
  ).bind(artifactId).first<{ version_id: string }>();
  const ids = new Set<string>();
  if (!dep) return ids;

  const key = `${artifactId}:${dep.version_id}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { results } = await env.DB.prepare(
    'SELECT r2_key, mime, size_bytes FROM assets WHERE version_id = ? LIMIT ?'
  ).bind(dep.version_id, MAX_ASSETS).all<{ r2_key: string; mime: string; size_bytes: number }>();
  await Promise.all(results.filter((a) => isText(a.mime) && a.size_bytes <= MAX_ASSET_BYTES).map(async (a) => {
    const obj = await env.ARTIFACTS.get(a.r2_key);
    if (!obj) return;
    for (const m of (await obj.text()).matchAll(ID_TOKEN)) ids.add(m[0]);
  }));

  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(key, ids);
  return ids;
}

export async function isSpreadsheetInArtifact(env: Env, artifactId: string, spreadsheetId: string): Promise<boolean> {
  const synced = await env.DB.prepare(
    'SELECT 1 FROM sheet_syncs WHERE artifact_id = ? AND spreadsheet_id = ? LIMIT 1'
  ).bind(artifactId, spreadsheetId).first();
  if (synced) return true;
  return (await sourceIds(env, artifactId)).has(spreadsheetId);
}
