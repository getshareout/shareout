import type { Env } from '../types';
import type { DataContext } from '../data/middleware';
import { createMiniDb } from '../data/minidb-client';
import type { CrewPrincipal, CrewRow, CrewRunRow } from './types';

/**
 * A crew acts with the owner's data scope (its "employee" power): reads are
 * unfiltered. This is the ONE place that encodes acts-as-owner — Phase 2 swaps
 * it for a scoped principal without touching the run loop or tools. We force
 * viewerScope to null rather than depending on the trigger being the owner.
 */
export function buildCrewDataContext(ownerCtx: DataContext): DataContext {
  return { ...ownerCtx, viewerScope: null };
}

/**
 * Build a crew's data context from env alone (no request) for autonomous runs
 * (cron/event). The env-based analog of dataMiddleware, always at owner scope.
 */
export async function buildOwnerDataContextForCrew(env: Env, crew: CrewRow): Promise<DataContext> {
  const workspaceId = crew.workspace_id ?? '';
  const artifact = await env.DB.prepare(
    'SELECT id, name, visibility, auth_method, workspace_id, owner_id FROM artifacts WHERE id = ?'
  )
    .bind(crew.artifact_id)
    .first<{ id: string; name: string; visibility: string; auth_method: string | null; workspace_id: string | null; owner_id: string | null }>();

  return {
    artifactId: crew.artifact_id,
    workspaceId,
    artifact: artifact ?? {
      id: crew.artifact_id,
      name: '',
      visibility: 'private',
      auth_method: null,
      workspace_id: crew.workspace_id,
      owner_id: crew.owner_id,
    },
    db: createMiniDb(env, crew.artifact_id, workspaceId),
    env,
    origin: null,
    viewerScope: null,
  };
}

export function buildCrewPrincipal(crew: CrewRow, run: CrewRunRow): CrewPrincipal {
  return {
    crewId: crew.id,
    runId: run.id,
    ownerId: crew.owner_id,
    artifactId: crew.artifact_id,
    workspaceId: crew.workspace_id ?? '',
  };
}

// Redaction for the ledger: drop secret-looking keys and cap size before any
// crew_run_events write (reuses the secret_audit_log discipline).
const SECRET_KEY = /(secret|token|password|api[_-]?key|authorization|cookie|credential)/i;
const MAX_LEN = 4000;

export function redact(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value, (key, val) => (SECRET_KEY.test(key) ? '[redacted]' : val));
  } catch {
    json = String(value);
  }
  if (json && json.length > MAX_LEN) json = json.slice(0, MAX_LEN) + '…[truncated]';
  return json ?? '';
}
