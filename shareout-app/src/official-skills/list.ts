// GET /v1/skills/recommended — the curated "Recommended by ShareOut" strip shown
// in every workspace's Skill Library. Workspace-agnostic and available to any signed-in
// user (free included): official skills live in a hidden system workspace and are
// surfaced read-only here. Display fields come from the registry so third-party
// summaries stay short and on-brand; metrics/ids come from the published artifacts.
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { json } from '../artifacts/json-response';
import { OFFICIAL_SKILLS } from './registry';

interface OfficialRow {
  id: string;
  slug: string;            // routing slug
  display_slug: string;    // os-<registry slug>
  official_rank: number;
  use_count: number;
}

export async function handleListRecommendedSkills(env: Env, _user: AuthUser): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT a.id, a.slug, a.display_slug, sm.official_rank, sm.use_count
       FROM skill_marketplace sm JOIN artifacts a ON a.id = sm.artifact_id
      WHERE sm.official = 1 AND sm.blocked = 0 AND a.deleted_at IS NULL
      ORDER BY sm.official_rank ASC`
  ).all<OfficialRow>();

  const byRegistrySlug = new Map<string, OfficialRow>();
  for (const r of (rows.results ?? [])) {
    // display_slug is os-<registry slug>; recover the registry slug.
    const regSlug = r.display_slug.replace(/^os-/, '');
    byRegistrySlug.set(regSlug, r);
  }

  const base = env.SHAREOUT_BASE_URL.replace(/\/$/, '');
  const skills = OFFICIAL_SKILLS
    .map((def) => {
      const row = byRegistrySlug.get(def.slug);
      if (!row) return null; // not yet synced
      return {
        slug: def.slug,
        artifact_id: row.id,
        name: def.name,
        summary: def.summary,
        category: def.category,
        tags: def.tags,
        attribution: def.attribution ?? null,
        uses: row.use_count,
        url: `${base}/a/${row.slug}/`,
        official: true,
      };
    })
    .filter(Boolean);

  return json({ skills });
}

/**
 * The official skills as agentskills.io discovery entries, for the unauthenticated
 * `/.well-known/agent-skills/index.json`. They are instance-wide and readable by
 * anyone, so an agent can enumerate and fetch them before it has a token — which is
 * the difference between "ShareOut has one skill" and "ShareOut is a skill source".
 * Best-effort: a sync that has not run yet yields an empty list, never an error page.
 */
export async function listOfficialSkillEntries(
  env: Env,
  origin: string
): Promise<Array<Record<string, string>>> {
  let rows: { results?: OfficialRow[] };
  try {
    rows = await env.DB.prepare(
      `SELECT a.id, a.slug, a.display_slug, sm.official_rank, sm.use_count
         FROM skill_marketplace sm JOIN artifacts a ON a.id = sm.artifact_id
        WHERE sm.official = 1 AND sm.blocked = 0 AND a.deleted_at IS NULL
        ORDER BY sm.official_rank ASC`
    ).all<OfficialRow>();
  } catch {
    return [];
  }

  const ids = new Map((rows.results ?? []).map(r => [r.display_slug.replace(/^os-/, ''), r.id]));
  const entries: Array<Record<string, string>> = [];
  for (const def of OFFICIAL_SKILLS) {
    // The canonical ShareOut skill is already the index's first entry.
    if (def.slug === 'shareout') continue;
    const id = ids.get(def.slug);
    if (!id) continue;
    entries.push({
      name: def.slug,
      type: 'skill-md',
      description: def.attribution ? `${def.summary} (by ${def.attribution})` : def.summary,
      url: `${origin}/v1/skills/${id}/raw`,
    });
  }
  return entries;
}
