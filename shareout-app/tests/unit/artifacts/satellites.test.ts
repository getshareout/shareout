// The two artifact satellites are optional: an artifact with no row in them must read
// exactly like one that has never been configured. Getting this wrong is quiet and
// dangerous — an INNER JOIN would drop the artifact from listings, and a missing
// COALESCE would make `moderation_status` NULL, which is not 'approved' and would hide
// a perfectly good page.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { setPresentation, setModeration } from '../../../src/artifacts/satellites';
import type { Env } from '../../../src/types';

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, visibility TEXT)`);
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS artifact_presentation (artifact_id TEXT PRIMARY KEY, social_title TEXT, social_description TEXT, social_image_url TEXT, thumbnail_ext TEXT, thumbnail_generated_at TEXT, pwa_config TEXT, has_mobile INTEGER NOT NULL DEFAULT 0, embed_allowed INTEGER NOT NULL DEFAULT 1, embed_origins TEXT, editor_readiness TEXT, auto_summary_hash TEXT)`,
  );
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'approved', reason TEXT, checked_at TEXT, content_hash TEXT, held_visibility TEXT)`,
  );
});

beforeEach(async () => {
  for (const t of ['artifacts', 'artifact_presentation', 'artifact_moderation']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  await e.DB.prepare("INSERT INTO artifacts (id, name, visibility) VALUES ('art_1', 'A', 'public')").run();
});

/** The read shape every artifact query uses: LEFT JOIN + COALESCE the defaults. */
function readArtifact(id: string) {
  return e.DB.prepare(
    `SELECT a.id,
            COALESCE(m.status, 'approved') AS moderation_status,
            COALESCE(p.has_mobile, 0) AS has_mobile,
            COALESCE(p.embed_allowed, 1) AS embed_allowed,
            p.social_title
       FROM artifacts a
       LEFT JOIN artifact_moderation m ON m.artifact_id = a.id
       LEFT JOIN artifact_presentation p ON p.artifact_id = a.id
      WHERE a.id = ?`,
  ).bind(id).first<{
    id: string; moderation_status: string; has_mobile: number; embed_allowed: number; social_title: string | null;
  }>();
}

describe('artifact satellites', () => {
  it('an artifact with no satellite rows reads as approved, embeddable, non-mobile', async () => {
    expect(await readArtifact('art_1')).toEqual({
      id: 'art_1',
      moderation_status: 'approved',
      has_mobile: 0,
      embed_allowed: 1,
      social_title: null,
    });
  });

  it('setPresentation creates the row, then patches it without clearing other columns', async () => {
    await setPresentation(e, 'art_1', { social_title: 'Hello' });
    await setPresentation(e, 'art_1', { has_mobile: 1 });

    const row = await readArtifact('art_1');
    expect(row!.social_title).toBe('Hello'); // survived the second write
    expect(row!.has_mobile).toBe(1);
    expect(row!.embed_allowed).toBe(1); // never mentioned, still the default
  });

  it('omitting a key preserves it; passing null clears it', async () => {
    await setPresentation(e, 'art_1', { social_title: 'Keep me' });

    await setPresentation(e, 'art_1', { social_description: 'x', social_title: undefined });
    expect((await readArtifact('art_1'))!.social_title).toBe('Keep me');

    await setPresentation(e, 'art_1', { social_title: null });
    expect((await readArtifact('art_1'))!.social_title).toBeNull();
  });

  it('setModeration upserts the same way', async () => {
    await setModeration(e, 'art_1', { status: 'pending', reason: 'held' });
    expect((await readArtifact('art_1'))!.moderation_status).toBe('pending');

    await setModeration(e, 'art_1', { status: 'approved' });
    const after = await e.DB.prepare('SELECT status, reason FROM artifact_moderation WHERE artifact_id = ?')
      .bind('art_1').first<{ status: string; reason: string | null }>();
    expect(after).toEqual({ status: 'approved', reason: 'held' }); // reason untouched
  });

  it('writing nothing is a no-op, not an empty INSERT', async () => {
    await setPresentation(e, 'art_1', {});
    const n = await e.DB.prepare('SELECT COUNT(*) AS n FROM artifact_presentation').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});
