/**
 * Pre-flight for jobs that name a connection (query_snapshot, materialize,
 * sheets_append, Slack bot delivery): the connection must exist on the artifact
 * or its workspace. Without this a job saves fine and then fails on every tick.
 */
import type { Env } from '../../types';
import type { JobConfig } from './types';

/** Actionable error when the job's `config.connection` doesn't exist, else null. */
export async function missingJobConnection(env: Env, artifactId: string, config: JobConfig): Promise<string | null> {
  const name = (config as { connection?: unknown }).connection;
  if (typeof name !== 'string' || !name) return null;

  const found = await env.DB.prepare(
    `SELECT 1 AS found FROM connections
      WHERE name = ?
        AND ((scope_type = 'artifact' AND scope_id = ?)
          OR (scope_type = 'workspace' AND scope_id = (SELECT workspace_id FROM artifacts WHERE id = ?)))
      LIMIT 1`,
  ).bind(name, artifactId, artifactId).first<{ found: number }>();
  if (found) return null;

  return `Connection "${name}" isn't set up in this workspace. Connect it under Connectors, then try again.`;
}
