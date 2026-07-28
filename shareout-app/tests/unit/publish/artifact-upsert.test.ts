// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { upsertArtifactRecord, type ArtifactUpsertInput } from '../../../src/publish/artifact-upsert';
import type { AuthMethod, Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

const USER = { id: 'usr_1' } as AuthUser;
const EXISTING = { id: 'art_1', owner_id: 'usr_1', slug: 'r', workspace_id: null };

// Captures every statement updateArtifactRow issues so we can assert what publish
// writes for password_hash (spine) and embed (artifact_presentation) on a re-publish.
function makeEnv() {
  const updates: Array<{ sql: string; args: unknown[] }> = [];
  const all: Array<{ sql: string; args: unknown[] }> = [];
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            all.push({ sql, args });
            if (sql.startsWith('UPDATE artifacts SET')) updates.push({ sql, args });
            return { success: true, meta: { changes: 1 } };
          },
          first: async () => (sql.includes('MAX(version_no)') ? { max_v: 1 } : null),
        }),
      }),
    },
  } as unknown as Env;
  return { env, updates, all };
}

function input(over: Partial<ArtifactUpsertInput>): ArtifactUpsertInput {
  return {
    slug: 'r', name: 'n', effectiveVisibility: 'unlisted', authMethod: 'password',
    workspaceId: null, folderId: null, hasMobile: false, storedType: 'html',
    typeMetadata: {}, accessPolicyJson: null,
    ...over,
  } as ArtifactUpsertInput;
}

// bind order in updateArtifactRow's UPDATE
const CLEAR_PW = 2;
const PW_HASH = 3;

let lastAll: Array<{ sql: string; args: unknown[] }> = [];
const captured = () => lastAll;

async function republish(over: Partial<ArtifactUpsertInput>) {
  const { env, updates, all } = makeEnv();
  await upsertArtifactRecord(env, USER, input(over), EXISTING, null);
  lastAll = all;
  return updates[0];
}

describe('re-publish preserves protection & embed', () => {
  it('keeps password when republishing without resending it', async () => {
    const u = await republish({ authMethod: 'password', password: undefined });
    // COALESCE(?, password_hash) with a null hash keeps the stored one; clear flag off.
    expect(u.sql).toContain('password_hash = CASE WHEN ? THEN NULL ELSE COALESCE(?, password_hash) END');
    expect(u.args[CLEAR_PW]).toBe(0);
    expect(u.args[PW_HASH]).toBeNull();
  });

  it('clears the password when auth is switched off password', async () => {
    const u = await republish({ authMethod: 'google' as AuthMethod, password: undefined });
    expect(u.args[CLEAR_PW]).toBe(1);
  });

  it('sets a fresh hash when a new password is sent', async () => {
    const u = await republish({ authMethod: 'password', password: 'hunter2' });
    expect(u.args[CLEAR_PW]).toBe(0);
    expect(typeof u.args[PW_HASH]).toBe('string');
    expect(u.args[PW_HASH]).not.toBe('hunter2'); // hashed, not raw
  });

  it('writes embed settings to artifact_presentation on update', async () => {
    const u = await republish({ embed: { allowed: false, origins: ['https://x.com'] } });
    // The spine UPDATE no longer carries presentation columns at all.
    expect(u.sql).not.toContain('embed_allowed');
    const pres = captured().find((c) => c.sql.includes('INSERT INTO artifact_presentation'));
    expect(pres).toBeTruthy();
    expect(pres!.sql).toContain('embed_allowed');
    expect(pres!.sql).toContain('embed_origins');
    expect(pres!.args).toContain(0);
    expect(pres!.args).toContain('["https://x.com"]');
  });

  it('leaves embed settings alone when a republish does not mention embed', async () => {
    await republish({});
    const pres = captured().find((c) => c.sql.includes('INSERT INTO artifact_presentation'));
    // Omitting the key is what preserves the stored value — the old SQL used COALESCE.
    expect(pres!.sql).not.toContain('embed_allowed');
    expect(pres!.sql).not.toContain('embed_origins');
  });
});
