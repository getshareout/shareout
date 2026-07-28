import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../../src/types';
import { enqueueIngest } from '../../../src/knowledge';

const e = env as unknown as Env;
const WS = 'wsp_kn_ing';

beforeAll(async () => {
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS knowledge_ingest (workspace_id TEXT NOT NULL, artifact_id TEXT NOT NULL, content_hash TEXT, reason TEXT NOT NULL, queued_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT, PRIMARY KEY (workspace_id, artifact_id, reason))`
  );
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM knowledge_ingest');
});

async function row(artifactId: string) {
  return e.DB.prepare(
    'SELECT content_hash, processed_at FROM knowledge_ingest WHERE workspace_id = ? AND artifact_id = ? AND reason = ?'
  )
    .bind(WS, artifactId, 'publish')
    .first<{ content_hash: string | null; processed_at: string | null }>();
}

describe('enqueueIngest hash-debounce', () => {
  it('one row per key; re-enqueuing after processing the same hash is a no-op', async () => {
    await enqueueIngest(e, WS, 'art_1', 'publish', 'v1');
    let r = await row('art_1');
    expect(r?.content_hash).toBe('v1');
    expect(r?.processed_at).toBeNull();

    await e.DB.prepare(
      "UPDATE knowledge_ingest SET processed_at = datetime('now') WHERE artifact_id = 'art_1'"
    ).run();

    await enqueueIngest(e, WS, 'art_1', 'publish', 'v1');
    r = await row('art_1');
    expect(r?.processed_at).not.toBeNull();

    const count = await e.DB.prepare(
      "SELECT COUNT(*) AS n FROM knowledge_ingest WHERE artifact_id = 'art_1'"
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('a changed hash re-opens the row as unprocessed', async () => {
    await enqueueIngest(e, WS, 'art_2', 'publish', 'v1');
    await e.DB.prepare(
      "UPDATE knowledge_ingest SET processed_at = datetime('now') WHERE artifact_id = 'art_2'"
    ).run();

    await enqueueIngest(e, WS, 'art_2', 'publish', 'v2');
    const r = await row('art_2');
    expect(r?.content_hash).toBe('v2');
    expect(r?.processed_at).toBeNull();
  });
});
