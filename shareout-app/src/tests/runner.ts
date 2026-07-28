// Artifact Tests — run orchestrator. Loads config, runs the available tiers,
// derives an overall status + a separate BLOCK-gating decision, persists the run.
// See specs/artifact-tests.md.

import type { Env } from '../types';
import { createRun, finishRun, getTestConfig, setBaseline } from './config';
import { scanPolicy } from './policy-scanner';
import { runContract } from './contract';
import { runSmoke } from './smoke';
import { runFlows } from './flows';
import { alertOwnerOnFailure } from './notify';
import type { TestResult, TestRun, TestStatus, TestTrigger } from './types';

// errored dominates (we couldn't trust the run) → never a pass, never a promote.
export function deriveStatus(results: TestResult[]): TestStatus {
  if (results.some((r) => r.status === 'errored')) return 'errored';
  if (results.some((r) => r.status === 'failed')) return 'failed';
  return 'passed';
}

// BLOCK promotion gating considers FUNCTIONAL tiers only — policy is advisory
// (surfaced + alerted, never holds a version). A version promotes iff no functional
// tier failed or errored.
const GATING_TIERS = new Set(['smoke', 'contract', 'flow']);
export function isPromotable(results: TestResult[]): boolean {
  return !results.some((r) => GATING_TIERS.has(r.tier) && r.status !== 'passed');
}

async function loadEntrypointHtml(env: Env, versionId: string): Promise<string | null> {
  const asset = await env.DB.prepare(`
    SELECT ast.r2_key FROM versions v
    JOIN assets ast ON ast.version_id = v.id AND ast.path = v.entrypoint
    WHERE v.id = ?
  `).bind(versionId).first<{ r2_key: string }>();
  if (!asset) return null;
  const obj = await env.ARTIFACTS.get(asset.r2_key);
  return obj ? await obj.text() : null;
}

export interface RunOptions {
  artifactId: string;
  workspaceId: string;
  versionId: string;
  trigger: TestTrigger;
  triggeredBy: string | null;
}

export interface RunOutcome {
  run: TestRun;
  promotable: boolean;
}

/** Execute the enabled Phase-1 tiers (policy + T2 contract) for a version and
 *  persist the result. Smoke (T1, browser) is wired in via runner-smoke once the
 *  thumbnail render is threaded in. Returns the persisted run + promote decision. */
export async function runTests(env: Env, opts: RunOptions): Promise<RunOutcome | null> {
  const config = await getTestConfig(env, opts.artifactId);
  if (!config || !config.enabled) return null;

  const runId = await createRun(env, {
    artifactId: opts.artifactId,
    versionId: opts.versionId,
    trigger: opts.trigger,
    mode: config.mode,
    triggeredBy: opts.triggeredBy,
  });

  const results: TestResult[] = [];

  // Policy (static) — needs the entrypoint HTML. Missing HTML is a harness error.
  const html = await loadEntrypointHtml(env, opts.versionId);
  if (html === null) {
    results.push({ name: 'load entrypoint', tier: 'smoke', status: 'errored', message: 'could not read entrypoint HTML' });
  } else {
    results.push(...scanPolicy(html));
  }

  // T1 smoke (browser) — renders the artifact (the candidate version for BLOCK
  // gating), catches JS errors / blank screen. Skipped when BROWSER unavailable.
  results.push(...await runSmoke(env, opts.artifactId, opts.versionId));

  // T2 contract (read-only) — only if the spec declares assertions.
  if (config.spec?.contract?.length) {
    results.push(...await runContract(env, opts.artifactId, opts.workspaceId, config.spec.contract));
  }

  // T3 flows (browser, sandboxed read-only render) — only if the spec declares them.
  if (config.spec?.flows?.length) {
    results.push(...await runFlows(env, opts.artifactId, opts.versionId, config.spec.flows));
  }

  const status = deriveStatus(results);
  const promotable = isPromotable(results);
  await finishRun(env, runId, status, results);

  // Record a passing version as the BLOCK-mode baseline (the known-good fallback).
  if (status === 'passed') await setBaseline(env, opts.artifactId, opts.versionId);

  const run: TestRun = {
    id: runId,
    artifact_id: opts.artifactId,
    version_id: opts.versionId,
    trigger: opts.trigger,
    mode: config.mode,
    status,
    passed_count: results.filter((r) => r.status === 'passed').length,
    failed_count: results.filter((r) => r.status === 'failed').length,
    errored_count: results.filter((r) => r.status === 'errored').length,
    results,
    triggered_by: opts.triggeredBy,
    started_at: '',
    finished_at: null,
  };

  // Nudge the owner when something's wrong (best-effort, never throws).
  if (status !== 'passed') await alertOwnerOnFailure(env, opts.artifactId, run);

  return { run, promotable };
}
