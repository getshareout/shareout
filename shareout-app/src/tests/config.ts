// Artifact Tests — config + run persistence (D1). See specs/artifact-tests.md.

import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import type {
  ArtifactTestConfig, TestMode, TestRun, TestResult, TestSpec, TestStatus, TestTrigger,
} from './types';

interface ConfigRow {
  artifact_id: string;
  enabled: number;
  mode: TestMode;
  spec: string | null;
  baseline_version_id: string | null;
  created_at: string;
  updated_at: string;
}

function parseSpec(raw: string | null): TestSpec | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as TestSpec; } catch { return null; }
}

export async function getTestConfig(env: Env, artifactId: string): Promise<ArtifactTestConfig | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM artifact_tests WHERE artifact_id = ?',
  ).bind(artifactId).first<ConfigRow>();
  if (!row) return null;
  return {
    artifact_id: row.artifact_id,
    enabled: row.enabled === 1,
    mode: row.mode,
    spec: parseSpec(row.spec),
    baseline_version_id: row.baseline_version_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function upsertTestConfig(
  env: Env,
  artifactId: string,
  patch: { enabled?: boolean; mode?: TestMode; spec?: TestSpec | null; baselineVersionId?: string | null },
): Promise<void> {
  // Read-merge-write: only the fields present in `patch` change; the rest keep
  // their current value (or the column default on first insert).
  const cur = await getTestConfig(env, artifactId);
  const enabled = patch.enabled ?? cur?.enabled ?? false;
  const mode = patch.mode ?? cur?.mode ?? 'monitor';
  const spec = patch.spec !== undefined ? patch.spec : (cur?.spec ?? null);
  const baseline = patch.baselineVersionId !== undefined
    ? patch.baselineVersionId
    : (cur?.baseline_version_id ?? null);
  await env.DB.prepare(`
    INSERT INTO artifact_tests (artifact_id, enabled, mode, spec, baseline_version_id, updated_at)
    VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(artifact_id) DO UPDATE SET
      enabled = excluded.enabled,
      mode = excluded.mode,
      spec = excluded.spec,
      baseline_version_id = excluded.baseline_version_id,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(
    artifactId,
    enabled ? 1 : 0,
    mode,
    spec ? JSON.stringify(spec) : null,
    baseline,
  ).run();
}

export async function setBaseline(env: Env, artifactId: string, versionId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE artifact_tests SET baseline_version_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE artifact_id = ?",
  ).bind(versionId, artifactId).run();
}

export async function createRun(
  env: Env,
  args: { artifactId: string; versionId: string | null; trigger: TestTrigger; mode: TestMode; triggeredBy: string | null },
): Promise<string> {
  const id = generateId('trun');
  await env.DB.prepare(`
    INSERT INTO artifact_test_runs (id, artifact_id, version_id, trigger, mode, status, triggered_by)
    VALUES (?, ?, ?, ?, ?, 'running', ?)
  `).bind(id, args.artifactId, args.versionId, args.trigger, args.mode, args.triggeredBy).run();
  return id;
}

export async function finishRun(
  env: Env,
  runId: string,
  status: TestStatus,
  results: TestResult[],
): Promise<void> {
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const errored = results.filter((r) => r.status === 'errored').length;
  await env.DB.prepare(`
    UPDATE artifact_test_runs
    SET status = ?, passed_count = ?, failed_count = ?, errored_count = ?, results = ?,
        finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).bind(status, passed, failed, errored, JSON.stringify(results), runId).run();
}

function rowToRun(row: Record<string, unknown>): TestRun {
  let results: TestResult[] = [];
  if (typeof row.results === 'string') {
    try { results = JSON.parse(row.results) as TestResult[]; } catch { results = []; }
  }
  return {
    id: row.id as string,
    artifact_id: row.artifact_id as string,
    version_id: (row.version_id as string | null) ?? null,
    trigger: row.trigger as TestTrigger,
    mode: row.mode as TestMode,
    status: row.status as TestStatus,
    passed_count: (row.passed_count as number) ?? 0,
    failed_count: (row.failed_count as number) ?? 0,
    errored_count: (row.errored_count as number) ?? 0,
    results,
    triggered_by: (row.triggered_by as string | null) ?? null,
    started_at: row.started_at as string,
    finished_at: (row.finished_at as string | null) ?? null,
  };
}

export async function getLatestRun(env: Env, artifactId: string): Promise<TestRun | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM artifact_test_runs WHERE artifact_id = ? ORDER BY started_at DESC LIMIT 1',
  ).bind(artifactId).first<Record<string, unknown>>();
  return row ? rowToRun(row) : null;
}

export async function listRuns(env: Env, artifactId: string, limit = 20): Promise<TestRun[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM artifact_test_runs WHERE artifact_id = ? ORDER BY started_at DESC LIMIT ?',
  ).bind(artifactId, limit).all<Record<string, unknown>>();
  return (results ?? []).map(rowToRun);
}
