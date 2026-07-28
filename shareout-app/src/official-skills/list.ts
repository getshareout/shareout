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
