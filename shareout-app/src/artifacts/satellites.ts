/**
 * Writers for the two 1:1 artifact satellites.
 *
 * Both tables are optional: no row means every column is at its default, which is
 * what the readers COALESCE to. So every write is an upsert — callers never have to
 * know whether a row exists, and nothing has to be created up front when an artifact
 * is published.
 */
import type { Env } from '../types';

export interface PresentationFields {
  social_title?: string | null;
  social_description?: string | null;
  social_image_url?: string | null;
  thumbnail_ext?: string | null;
  thumbnail_generated_at?: string | null;
  pwa_config?: string | null;
  has_mobile?: number;
  embed_allowed?: number;
  embed_origins?: string | null;
  editor_readiness?: string | null;
  auto_summary_hash?: string | null;
}

export interface ModerationFields {
  status?: string;
  reason?: string | null;
  checked_at?: string | null;
  content_hash?: string | null;
  held_visibility?: string | null;
}

async function upsert(
  env: Env,
  table: 'artifact_presentation' | 'artifact_moderation',
  artifactId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  // `undefined` means "leave it alone" — it never reaches the statement. Pass null to
  // actually clear a column.
  const cols = Object.keys(fields).filter((c) => fields[c] !== undefined);
  if (!cols.length) return;
  // `excluded` carries the values this statement supplied, so an existing row keeps
  // every column the caller did not mention.
  const sets = cols.map((c) => `${c} = excluded.${c}`).join(', ');
  await env.DB.prepare(
    `INSERT INTO ${table} (artifact_id, ${cols.join(', ')})
     VALUES (?, ${cols.map(() => '?').join(', ')})
     ON CONFLICT(artifact_id) DO UPDATE SET ${sets}`,
  ).bind(artifactId, ...cols.map((c) => fields[c] as never)).run();
}

export function setPresentation(env: Env, artifactId: string, fields: PresentationFields): Promise<void> {
  return upsert(env, 'artifact_presentation', artifactId, fields as Record<string, unknown>);
}

export function setModeration(env: Env, artifactId: string, fields: ModerationFields): Promise<void> {
  return upsert(env, 'artifact_moderation', artifactId, fields as Record<string, unknown>);
}

/**
 * The columns every artifact read needs, with the satellite defaults applied. Join
 * with `artifactSatelliteJoin(alias)` and select this — a missing satellite row then
 * reads exactly like an artifact nobody has configured.
 */
export function artifactSatelliteSelect(a = 'a'): string {
  return `COALESCE(mod_${a}.status, 'approved') AS moderation_status,
          mod_${a}.reason AS moderation_reason,
          mod_${a}.checked_at AS moderation_checked_at,
          mod_${a}.content_hash AS moderation_content_hash,
          mod_${a}.held_visibility AS moderation_held_visibility,
          pres_${a}.social_title, pres_${a}.social_description, pres_${a}.social_image_url,
          pres_${a}.thumbnail_ext, pres_${a}.thumbnail_generated_at, pres_${a}.pwa_config,
          COALESCE(pres_${a}.has_mobile, 0) AS has_mobile,
          COALESCE(pres_${a}.embed_allowed, 1) AS embed_allowed,
          pres_${a}.embed_origins, pres_${a}.editor_readiness, pres_${a}.auto_summary_hash`;
}

/** LEFT JOINs for artifactSatelliteSelect. Never INNER — a missing row is normal. */
export function artifactSatelliteJoin(a = 'a'): string {
  return `LEFT JOIN artifact_moderation mod_${a} ON mod_${a}.artifact_id = ${a}.id
          LEFT JOIN artifact_presentation pres_${a} ON pres_${a}.artifact_id = ${a}.id`;
}
