// Reconcile the curated "Recommended by ShareOut" skills into a hidden system
// workspace, then flag them official=1 so every workspace's Skill Library can list
// them. Runs daily from the cron and is fully idempotent: a skill is re-published
// only when its embedded content hash changes. Bootstraps the system user/workspace
// on first run. Never throws into the caller — a bad skill is skipped, not fatal.
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { publishArtifact } from '../publish';
import { OFFICIAL_SKILLS } from './registry';
import { OFFICIAL_SKILL_CONTENT } from './content.generated';

// Fixed ids so the system workspace/user are stable and referenceable across runs.
export const OFFICIAL_SYSTEM_USER_ID = 'usr_shareout_official';
export const OFFICIAL_SYSTEM_WORKSPACE_ID = 'wsp_shareout_official';
const OFFICIAL_SYSTEM_WORKSPACE_SLUG = 'shareout-official-system';
const OFFICIAL_SYSTEM_MEMBER_ID = 'wsm_shareout_official';

const SYSTEM_USER: AuthUser = {
  id: OFFICIAL_SYSTEM_USER_ID,
  email: 'official@shareout.site',
  username: 'shareout-official',
};

// display_slug used for each official skill's artifact — stable so publishArtifact
// dedupes (updates the same artifact) instead of forking a new one every sync.
function officialDisplaySlug(slug: string): string {
  return `os-${slug}`;
}

// Idempotently ensure the hidden system user + workspace exist. Returns false if the
// workspace couldn't be established (e.g. slug taken by a real workspace) so the
// caller can bail without publishing into the wrong place.
async function ensureSystemWorkspace(env: Env): Promise<boolean> {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO users (id, email, name, is_service) VALUES (?, ?, ?, 1)'
  ).bind(OFFICIAL_SYSTEM_USER_ID, SYSTEM_USER.email, 'ShareOut Official').run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, slug, description, owner_id)
       VALUES (?, ?, ?, ?, ?)`
  ).bind(
    OFFICIAL_SYSTEM_WORKSPACE_ID,
    'ShareOut Official',
    OFFICIAL_SYSTEM_WORKSPACE_SLUG,
    'System workspace hosting official recommended skills.',
    OFFICIAL_SYSTEM_USER_ID,
  ).run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role)
       VALUES (?, ?, ?, 'owner')`
  ).bind(OFFICIAL_SYSTEM_MEMBER_ID, OFFICIAL_SYSTEM_WORKSPACE_ID, OFFICIAL_SYSTEM_USER_ID).run();

  const ws = await env.DB.prepare(
    'SELECT id FROM workspaces WHERE id = ?'
  ).bind(OFFICIAL_SYSTEM_WORKSPACE_ID).first<{ id: string }>();
  return !!ws;
}

// Current content hash stored on the official skill row (null = never published).
async function storedHash(env: Env, displaySlug: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT sm.content_hash AS h
       FROM skill_marketplace sm JOIN artifacts a ON a.id = sm.artifact_id
      WHERE a.workspace_id = ? AND a.display_slug = ? AND a.deleted_at IS NULL`
  ).bind(OFFICIAL_SYSTEM_WORKSPACE_ID, displaySlug).first<{ h: string | null }>();
  return row ? (row.h ?? null) : null;
}

// True once at least one official skill has been published. Used to bootstrap the
// catalog on first deploy without waiting for the daily sync window.
export async function officialSkillsSynced(env: Env): Promise<boolean> {
  const r = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM skill_marketplace WHERE official = 1'
  ).first<{ n: number }>();
  return (r?.n ?? 0) > 0;
}

export interface OfficialSyncResult {
  published: string[];   // slugs (re)published this run
  unchanged: string[];   // slugs skipped (hash match)
  failed: { slug: string; error: string }[];
}

export async function syncOfficialSkills(env: Env): Promise<OfficialSyncResult> {
  const result: OfficialSyncResult = { published: [], unchanged: [], failed: [] };

  const ready = await ensureSystemWorkspace(env).catch(() => false);
  if (!ready) {
    result.failed.push({ slug: '*', error: 'system workspace unavailable' });
    return result;
  }

  for (let i = 0; i < OFFICIAL_SKILLS.length; i++) {
    const def = OFFICIAL_SKILLS[i];
    const content = OFFICIAL_SKILL_CONTENT[def.slug];
    if (!content) {
      result.failed.push({ slug: def.slug, error: 'missing embedded content' });
      continue;
    }
    const displaySlug = officialDisplaySlug(def.slug);
    try {
      const existing = await storedHash(env, displaySlug);
      if (existing === content.hash) {
        // Content unchanged, but rank/order metadata may have shifted — cheap refresh.
        await markOfficial(env, displaySlug, def.category, i, content.hash);
        result.unchanged.push(def.slug);
        continue;
      }

      const res = await publishArtifact(env, SYSTEM_USER, {
        name: def.name,
        slug: displaySlug,
        entrypoint: 'SKILL.md',
        files: [{ path: 'SKILL.md', content: content.markdown, mime: 'text/markdown', encoding: 'utf8' }],
        visibility: 'workspace',
        authMethod: 'google',
        shareWith: [],
        credentials: [],
        workspaceId: OFFICIAL_SYSTEM_WORKSPACE_ID,
        folderId: null,
        artifactType: 'skill',
      } as Parameters<typeof publishArtifact>[2]);

      await env.DB.prepare(
        `UPDATE skill_marketplace
            SET official = 1, official_rank = ?, content_hash = ?, category = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE artifact_id = ?`
      ).bind(i, content.hash, def.category, res.artifact.id).run();

      result.published.push(def.slug);
    } catch (e) {
      result.failed.push({ slug: def.slug, error: (e as Error).message || 'unknown' });
    }
  }

  return result;
}

// Refresh official flags on an already-published skill (no new version).
async function markOfficial(
  env: Env,
  displaySlug: string,
  category: string,
  rank: number,
  hash: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE skill_marketplace
        SET official = 1, official_rank = ?, category = ?, content_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE artifact_id = (
        SELECT a.id FROM artifacts a
         WHERE a.workspace_id = ? AND a.display_slug = ? AND a.deleted_at IS NULL
      )`
  ).bind(rank, category, hash, OFFICIAL_SYSTEM_WORKSPACE_ID, displaySlug).run();
}
