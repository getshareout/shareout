// A re-publish by name only must update an artifact that was published under the legacy
// (accent-dashed) slug, never create a duplicate; a brand-new accented name gets a clean slug.
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { resolveNameSlug } from '../../../src/publish/artifact-upsert';
import { legacySlug, generateSlug } from '../../../src/validation';

const e = env as unknown as Env;
const NAME = 'Flujograma PG-08 Cotización';

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, display_slug TEXT, owner_id TEXT, workspace_id TEXT, deleted_at TEXT)`);
});
beforeEach(async () => { await e.DB.exec('DELETE FROM artifacts'); });

const put = (id: string, display: string, ws: string | null, owner = 'usr_1', deleted: string | null = null) =>
  e.DB.prepare('INSERT INTO artifacts (id, name, slug, display_slug, owner_id, workspace_id, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, NAME, display, display, owner, ws, deleted).run();

describe('legacySlug / generateSlug', () => {
  it('legacy keeps the old damage, the new one is clean', () => {
    expect(legacySlug(NAME)).toBe('flujograma-pg-08-cotizaci-n');
    expect(generateSlug(NAME)).toBe('flujograma-pg-08-cotizacion');
  });
});

describe('resolveNameSlug', () => {
  it('a brand-new accented name gets the clean slug', async () => {
    expect(await resolveNameSlug(e, NAME, 'wsp_a', 'usr_1')).toBe('flujograma-pg-08-cotizacion');
    expect(await resolveNameSlug(e, NAME, null, 'usr_1')).toBe('flujograma-pg-08-cotizacion');
  });

  it('an existing page under the legacy slug is reused (workspace scope)', async () => {
    await put('art_old', 'flujograma-pg-08-cotizaci-n', 'wsp_a');
    expect(await resolveNameSlug(e, NAME, 'wsp_a', 'usr_2')).toBe('flujograma-pg-08-cotizaci-n');
  });

  it('an existing page under the legacy slug is reused (personal scope, same owner only)', async () => {
    await put('art_old', 'flujograma-pg-08-cotizaci-n', null, 'usr_1');
    expect(await resolveNameSlug(e, NAME, null, 'usr_1')).toBe('flujograma-pg-08-cotizaci-n');
    expect(await resolveNameSlug(e, NAME, null, 'usr_2')).toBe('flujograma-pg-08-cotizacion');
  });

  it('prefers the clean slug when it already exists, and ignores other workspaces and deleted pages', async () => {
    await put('art_old', 'flujograma-pg-08-cotizaci-n', 'wsp_a');
    await put('art_new', 'flujograma-pg-08-cotizacion', 'wsp_a');
    expect(await resolveNameSlug(e, NAME, 'wsp_a', 'usr_1')).toBe('flujograma-pg-08-cotizacion');
    expect(await resolveNameSlug(e, NAME, 'wsp_b', 'usr_1')).toBe('flujograma-pg-08-cotizacion');
    await e.DB.exec('DELETE FROM artifacts');
    await put('art_gone', 'flujograma-pg-08-cotizaci-n', 'wsp_a', 'usr_1', '2026-01-01');
    expect(await resolveNameSlug(e, NAME, 'wsp_a', 'usr_1')).toBe('flujograma-pg-08-cotizacion');
  });

  it('names without accents are unaffected', async () => {
    expect(await resolveNameSlug(e, 'Plain Name', 'wsp_a', 'usr_1')).toBe('plain-name');
  });
});
