// Artifact Tests — REST handlers. Config + manual run + status.
// Authoring/enabling and manual runs are OWNER-ONLY (a test spec is an execution
// surface — see specs §7); reading status follows normal read access.

import type { FetchContext } from '../context';
import type { Env } from '../../types';
import { requireAuthUser, requireTokenOrSession, isAuthUser } from '../helpers/auth-guard';
import { jsonError, jsonResponse } from '../helpers/json-response';
import { getInternalWorkspaceRole } from '../../workspaces';
import { getTestConfig, upsertTestConfig, listRuns, getLatestRun } from '../../tests/config';
import { runTests } from '../../tests/runner';
import type { TestMode, TestSpec } from '../../tests/types';

type ArtifactRow = { owner_id: string | null; workspace_id: string | null };

async function loadArtifact(env: Env, artifactId: string): Promise<ArtifactRow | null> {
  return env.DB.prepare('SELECT owner_id, workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<ArtifactRow>();
}

async function currentVersionId(env: Env, artifactId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = 'production'",
  ).bind(artifactId).first<{ version_id: string }>();
  return row?.version_id ?? null;
}

async function canRead(env: Env, artifactId: string, userId: string, userEmail: string | null, a: ArtifactRow): Promise<boolean> {
  if (a.owner_id === userId) return true;
  if (a.workspace_id && (await getInternalWorkspaceRole(env, a.workspace_id, userId))) return true;
  const collab = await env.DB.prepare('SELECT 1 FROM collaborators WHERE artifact_id = ? AND email = ?')
    .bind(artifactId, userEmail).first();
  return !!collab;
}

/** GET /v1/artifacts/:id/tests — config + latest run + recent history. */
export async function handleGetTests(ctx: FetchContext, artifactId: string): Promise<Response> {
  const { env } = ctx;
  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;
  const artifact = await loadArtifact(env, artifactId);
  if (!artifact) return jsonError('Not found', 'NOT_FOUND', 404);
  if (!(await canRead(env, artifactId, user.id, user.email, artifact))) {
    return jsonError('Access denied', 'FORBIDDEN', 403);
  }
  const [config, latest, runs] = await Promise.all([
    getTestConfig(env, artifactId),
    getLatestRun(env, artifactId),
    listRuns(env, artifactId, 20),
  ]);
  return jsonResponse({ config, latest, runs });
}

/** PUT /v1/artifacts/:id/tests — enable/disable, set mode, set spec. Owner-only. */
export async function handleConfigureTests(ctx: FetchContext, artifactId: string): Promise<Response> {
  const { request, env } = ctx;
  const user = await requireAuthUser(ctx);
  if (!isAuthUser(user)) return user;
  const artifact = await loadArtifact(env, artifactId);
  if (!artifact) return jsonError('Not found', 'NOT_FOUND', 404);
  if (artifact.owner_id !== user.id) return jsonError('Owner only', 'FORBIDDEN', 403);

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean; mode?: TestMode; spec?: TestSpec | null;
  };
  if (body.mode && body.mode !== 'monitor' && body.mode !== 'block') {
    return jsonError('mode must be monitor or block', 'INVALID_MODE', 400);
  }

  // Enabling BLOCK on an artifact with a live version grandfathers it as the trusted
  // baseline so it stays served and never goes dark (specs §10.3).
  let baselineVersionId: string | undefined;
  const existing = await getTestConfig(env, artifactId);
  if (body.enabled && body.mode === 'block' && !existing?.baseline_version_id) {
    baselineVersionId = (await currentVersionId(env, artifactId)) ?? undefined;
  }

  await upsertTestConfig(env, artifactId, {
    enabled: body.enabled,
    mode: body.mode,
    spec: body.spec,
    baselineVersionId,
  });
  return jsonResponse({ config: await getTestConfig(env, artifactId) });
}

/** POST /v1/artifacts/:id/tests/run — run now against the live version. Owner-only.
 *  Manual runs bypass the per-artifact debounce (explicit intent). */
export async function handleRunTests(ctx: FetchContext, artifactId: string): Promise<Response> {
  const { env } = ctx;
  const user = await requireAuthUser(ctx);
  if (!isAuthUser(user)) return user;
  const artifact = await loadArtifact(env, artifactId);
  if (!artifact) return jsonError('Not found', 'NOT_FOUND', 404);
  if (artifact.owner_id !== user.id) return jsonError('Owner only', 'FORBIDDEN', 403);

  const config = await getTestConfig(env, artifactId);
  if (!config?.enabled) return jsonError('Tests are not enabled', 'TESTS_DISABLED', 400);

  const versionId = await currentVersionId(env, artifactId);
  if (!versionId) return jsonError('No published version', 'NO_VERSION', 400);

  const outcome = await runTests(env, {
    artifactId,
    workspaceId: artifact.workspace_id ?? '',
    versionId,
    trigger: 'manual',
    triggeredBy: user.id,
  });
  if (!outcome) return jsonError('Tests are not enabled', 'TESTS_DISABLED', 400);
  return jsonResponse({ run: outcome.run, promotable: outcome.promotable });
}
