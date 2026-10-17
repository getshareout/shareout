import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { parseCronSchedule, getNextRunTime } from '../scheduling/jobs/cron';
import { CREW_TOOLS } from './tool-registry';
import { resolveCrewLimits } from './limits';
import { validateConditionConfig } from './condition';
import type { CrewRow, CrewRunRow, CrewTriggerRow, ToolLimits } from './types';
import { DEFAULT_CLAUDE_MODEL, claudeModelById } from '../data/agent/models';
import { fetchGatewayModels } from '../data/agent/gateway-catalog';

// Event types a crew can subscribe to in Phase 1. Only table.row.inserted is
// wired for dispatch this phase; others are added as their emit sites gain the
// crew-event hook.
const CREW_EVENT_TYPES = new Set(['table.row.inserted']);

const DEFAULT_MODEL = DEFAULT_CLAUDE_MODEL.id;

/** A Vercel AI Gateway model id: `provider/model`. */
const GATEWAY_SLUG = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

/** What a crew may be told to run on, as stored in `crews.model`:
 *  - omitted → the default model, which follows the workspace/instance gateway model;
 *  - a Claude id ShareOut serves (`claude-haiku-4-5`) → that Claude model;
 *  - any gateway slug (`openai/gpt-5`, `anthropic/claude-sonnet-5.5`) → pinned to it.
 *  Shape-only; `resolveCrewModel` adds the catalog check. Null = not a model we can run. */
export function normalizeCrewModel(model: unknown): string | null {
  if (model == null || model === '') return DEFAULT_MODEL;
  if (typeof model !== 'string') return null;
  const m = model.trim();
  if (GATEWAY_SLUG.test(m)) return m;
  // The SDK's `crew.define({ model })` type still names the undated Sonnet alias.
  if (m === 'claude-sonnet-5') return DEFAULT_MODEL;
  return claudeModelById(m)?.id ?? null;
}

/** Validate a requested crew model. A gateway slug must be in the live gateway catalog
 *  (tool-capable language models); when the catalog can't be reached the slug's shape is
 *  enough, so an outage never blocks saving a crew. */
export async function resolveCrewModel(
  model: unknown,
  catalog: () => Promise<Array<{ id: string }>> = fetchGatewayModels,
): Promise<{ model: string } | { error: string }> {
  const normalized = normalizeCrewModel(model);
  if (!normalized) {
    return {
      error: `Unknown model ${JSON.stringify(model)}. Use a Vercel AI Gateway id like "anthropic/claude-sonnet-5.5" or "openai/gpt-5", a Claude id like "claude-haiku-4-5", or omit it for the workspace default.`,
    };
  }
  if (!normalized.includes('/') || claudeModelById(normalized)) return { model: normalized };
  let ids: Set<string> | null = null;
  try {
    ids = new Set((await catalog()).map((m) => m.id));
  } catch {
    ids = null;
  }
  if (ids && ids.size && !ids.has(normalized)) {
    return { error: `Model "${normalized}" is not a tool-capable model in the Vercel AI Gateway catalog.` };
  }
  return { model: normalized };
}

export interface DefineCrewBody {
  name?: string;
  instructions?: string;
  model?: string;
  maxIterations?: number;
  runBudgetMicroUsd?: number;
  tools?: {
    read?: string[];
    write?: string[];
    approval?: Record<string, string>;
    limits?: Record<string, ToolLimits>;
  };
}

export async function getCrew(env: Env, artifactId: string): Promise<CrewRow | null> {
  return env.DB.prepare('SELECT * FROM crews WHERE artifact_id = ? ORDER BY created_at LIMIT 1')
    .bind(artifactId)
    .first<CrewRow>();
}

export async function getCrewById(env: Env, crewId: string): Promise<CrewRow | null> {
  return env.DB.prepare('SELECT * FROM crews WHERE id = ?').bind(crewId).first<CrewRow>();
}

/** Upsert the artifact's crew and replace its grants from the requested read tools. */
export async function defineCrew(
  env: Env,
  artifactId: string,
  workspaceId: string,
  body: DefineCrewBody
): Promise<CrewRow> {
  const ownerRow = await env.DB.prepare('SELECT owner_id FROM artifacts WHERE id = ?')
    .bind(artifactId)
    .first<{ owner_id: string | null }>();
  const ownerId = ownerRow?.owner_id ?? '';

  // Callers validate with resolveCrewModel first (POST /crew/define answers 400);
  // anything that still isn't a model we can run is stored as the default.
  const model = normalizeCrewModel(body.model) ?? DEFAULT_MODEL;
  const existing = await getCrew(env, artifactId);
  const crewId = existing?.id ?? generateId('crew');

  // Plan-tier limits: clamp iterations to the cap; default the run budget per tier.
  const planLimits = await resolveCrewLimits(env, ownerId);
  const clampedMaxIter =
    body.maxIterations != null ? Math.min(body.maxIterations, planLimits.max_iterations_cap) : null;
  const runBudget = body.runBudgetMicroUsd ?? null;

  if (existing) {
    await env.DB.prepare(
      `UPDATE crews SET name = ?, instructions = ?, model = ?,
         max_iterations = COALESCE(?, max_iterations),
         run_budget_micro_usd = COALESCE(?, run_budget_micro_usd),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`
    )
      .bind(
        body.name ?? existing.name,
        body.instructions ?? existing.instructions,
        model,
        clampedMaxIter,
        runBudget,
        crewId
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO crews (id, artifact_id, workspace_id, owner_id, name, instructions, model,
         max_iterations, run_budget_micro_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crewId,
        artifactId,
        workspaceId || null,
        ownerId,
        body.name ?? null,
        body.instructions ?? null,
        model,
        clampedMaxIter ?? Math.min(8, planLimits.max_iterations_cap),
        runBudget ?? planLimits.default_run_budget_micro_usd
      )
      .run();
  }

  // Owner config is authoritative: wipe and rewrite grants from the request.
  await env.DB.prepare('DELETE FROM crew_grants WHERE crew_id = ?').bind(crewId).run();
  const limits = body.tools?.limits ?? {};
  const approval = body.tools?.approval ?? {};
  const addGrant = async (name: string, mode: 'read' | 'write') => {
    const tool = CREW_TOOLS[name];
    if (!tool || tool.mode !== mode) return;
    const limitsJson = limits[name] ? JSON.stringify(limits[name]) : null;
    const policy = approval[name] ?? tool.defaultApproval ?? 'never';
    await env.DB.prepare(
      `INSERT INTO crew_grants (crew_id, tool_name, mode, enabled, approval_policy, limits_json)
       VALUES (?, ?, ?, 1, ?, ?)`
    )
      .bind(crewId, name, mode, policy, limitsJson)
      .run();
  };
  for (const name of body.tools?.read ?? []) await addGrant(name, 'read');
  for (const name of body.tools?.write ?? []) await addGrant(name, 'write');

  const crew = await getCrew(env, artifactId);
  if (!crew) throw new Error('failed to load crew after define');
  return crew;
}

export async function createRun(
  env: Env,
  crew: CrewRow,
  input: string,
  initiatedBy: string | null,
  triggerKind: string = 'manual'
): Promise<CrewRunRow> {
  const id = generateId('crun');
  await env.DB.prepare(
    `INSERT INTO crew_runs (id, crew_id, artifact_id, trigger_kind, initiated_by, status, input_json)
     VALUES (?, ?, ?, ?, ?, 'running', ?)`
  )
    .bind(id, crew.id, crew.artifact_id, triggerKind, initiatedBy, input ? JSON.stringify({ input }) : null)
    .run();
  const run = await env.DB.prepare('SELECT * FROM crew_runs WHERE id = ?').bind(id).first<CrewRunRow>();
  if (!run) throw new Error('failed to load run after create');
  return run;
}

// A run still 'running' this long after it started was killed by the platform
// (worker eviction/CPU/OOM) before finalize could run — no legitimate run lives
// past the ~30s worker wall. Such rows would otherwise count toward the owner's
// concurrency cap forever (countActiveRuns), silently deadlocking future runs.
const STALE_RUN_SECONDS = 300;

/** Mark abandoned 'running' runs as failed so they stop consuming a concurrency slot. */
export async function reapStaleRuns(env: Env): Promise<number> {
  const r = await env.DB.prepare(
    `UPDATE crew_runs SET status = 'error', termination_reason = 'abandoned', ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE status = 'running' AND started_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-' || ? || ' seconds')`
  )
    .bind(STALE_RUN_SECONDS)
    .run();
  return r.meta.changes || 0;
}

export async function listRuns(env: Env, crewId: string, limit = 20): Promise<CrewRunRow[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM crew_runs WHERE crew_id = ? ORDER BY started_at DESC LIMIT ?'
  )
    .bind(crewId, Math.min(limit, 100))
    .all<CrewRunRow>();
  return result.results;
}

export async function getRun(env: Env, runId: string): Promise<CrewRunRow | null> {
  return env.DB.prepare('SELECT * FROM crew_runs WHERE id = ?').bind(runId).first<CrewRunRow>();
}

export async function getRunEvents(env: Env, runId: string): Promise<Record<string, unknown>[]> {
  const result = await env.DB.prepare(
    `SELECT id, run_id, crew_id, seq, event_type, tool_name, input_json, output_json,
            token_input, token_output, latency_ms, created_at
     FROM crew_run_events WHERE run_id = ? ORDER BY seq`
  )
    .bind(runId)
    .all();
  return result.results as Record<string, unknown>[];
}

// ── Triggers ────────────────────────────────────────────────────────────────

export interface CreateTriggerBody {
  kind?: 'cron' | 'event' | 'condition';
  cron?: string;
  eventType?: string;
  condition?: unknown; // ConditionConfig (validated in createTrigger)
}

export async function listTriggers(env: Env, crewId: string): Promise<CrewTriggerRow[]> {
  const r = await env.DB.prepare(
    'SELECT * FROM crew_triggers WHERE crew_id = ? ORDER BY created_at'
  )
    .bind(crewId)
    .all<CrewTriggerRow>();
  return r.results;
}

export async function createTrigger(
  env: Env,
  crew: CrewRow,
  body: CreateTriggerBody
): Promise<CrewTriggerRow | { error: string }> {
  const id = generateId('ctrg');

  if (body.kind === 'cron') {
    const cron = (body.cron || '').trim();
    const v = parseCronSchedule(cron);
    if (!v.valid) return { error: v.error || 'Invalid cron expression' };
    await env.DB.prepare(
      `INSERT INTO crew_triggers (id, crew_id, artifact_id, kind, cron, next_run_at)
       VALUES (?, ?, ?, 'cron', ?, ?)`
    )
      .bind(id, crew.id, crew.artifact_id, cron, getNextRunTime(cron))
      .run();
  } else if (body.kind === 'event') {
    const eventType = (body.eventType || '').trim();
    if (!CREW_EVENT_TYPES.has(eventType)) {
      return { error: `Unsupported event type. Allowed: ${[...CREW_EVENT_TYPES].join(', ')}` };
    }
    await env.DB.prepare(
      `INSERT INTO crew_triggers (id, crew_id, artifact_id, kind, event_type)
       VALUES (?, ?, ?, 'event', ?)`
    )
      .bind(id, crew.id, crew.artifact_id, eventType)
      .run();
  } else if (body.kind === 'condition') {
    const parsed = validateConditionConfig(body.condition ?? {});
    if (!parsed.ok) return { error: parsed.error };
    // Due immediately — first evaluation happens on the next hourly tick.
    await env.DB.prepare(
      `INSERT INTO crew_triggers (id, crew_id, artifact_id, kind, condition_json, next_run_at)
       VALUES (?, ?, ?, 'condition', ?, ?)`
    )
      .bind(id, crew.id, crew.artifact_id, JSON.stringify(parsed.config), Math.floor(Date.now() / 1000))
      .run();
  } else {
    return { error: 'kind must be "cron", "event", or "condition"' };
  }

  const row = await env.DB.prepare('SELECT * FROM crew_triggers WHERE id = ?').bind(id).first<CrewTriggerRow>();
  return row ?? { error: 'failed to load trigger after create' };
}

export async function updateTrigger(
  env: Env,
  crewId: string,
  triggerId: string,
  body: { enabled?: boolean; cron?: string; eventType?: string }
): Promise<CrewTriggerRow | { error: string }> {
  const existing = await env.DB.prepare('SELECT * FROM crew_triggers WHERE id = ? AND crew_id = ?')
    .bind(triggerId, crewId)
    .first<CrewTriggerRow>();
  if (!existing) return { error: 'Trigger not found' };

  const sets: string[] = [];
  const binds: unknown[] = [];

  if (typeof body.enabled === 'boolean') {
    sets.push('enabled = ?');
    binds.push(body.enabled ? 1 : 0);
  }
  if (existing.kind === 'cron' && typeof body.cron === 'string') {
    const cron = body.cron.trim();
    const v = parseCronSchedule(cron);
    if (!v.valid) return { error: v.error || 'Invalid cron expression' };
    sets.push('cron = ?', 'next_run_at = ?');
    binds.push(cron, getNextRunTime(cron));
  }
  if (existing.kind === 'event' && typeof body.eventType === 'string') {
    if (!CREW_EVENT_TYPES.has(body.eventType)) return { error: 'Unsupported event type' };
    sets.push('event_type = ?');
    binds.push(body.eventType);
  }

  if (!sets.length) return existing;

  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  binds.push(triggerId, crewId);
  await env.DB.prepare(`UPDATE crew_triggers SET ${sets.join(', ')} WHERE id = ? AND crew_id = ?`)
    .bind(...binds)
    .run();

  const row = await env.DB.prepare('SELECT * FROM crew_triggers WHERE id = ?').bind(triggerId).first<CrewTriggerRow>();
  return row ?? { error: 'failed to reload trigger' };
}

export async function deleteTrigger(env: Env, crewId: string, triggerId: string): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM crew_triggers WHERE id = ? AND crew_id = ? RETURNING id')
    .bind(triggerId, crewId)
    .first();
  return !!r;
}
