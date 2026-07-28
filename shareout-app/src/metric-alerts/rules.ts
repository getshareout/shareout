import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { getDestination, type DeliveryContext } from '../delivery/registry';
import {
  parseCronSchedule,
  getNextRunTime,
  checkViewerSelfDelivery,
  type JobAction,
  type JobConfig,
} from '../scheduling/jobs';
import { getArtifactRef, resolveAlertRole, type ArtifactRef } from './access';
import { isFeatureEnabled } from '../features/flags';
import { getDefinition } from './definitions';
import { evaluateMetric, evaluateCondition } from './sources';
import { runCrewForArtifact } from '../crew/dispatch';
import type { AlertCondition, AlertOp, AlertDestinationKind, MetricAlertRule, MetricDefinition, OnTrigger } from './types';

const ALERT_OPS: AlertOp[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'change_pct_gt', 'change_pct_lt'];
const ALERT_KINDS: AlertDestinationKind[] = ['slack', 'email', 'discord', 'webhook', 'http_get', 'telegram'];
const MAX_RULES_PER_ARTIFACT = 20;
const MAX_PERSONAL_RULES_PER_USER = 10;
const COOLDOWN_MIN = 60;
const COOLDOWN_MAX = 30 * 86400;

function clampCooldown(seconds: number | undefined): number {
  const v = typeof seconds === 'number' ? seconds : 86400;
  return Math.max(COOLDOWN_MIN, Math.min(COOLDOWN_MAX, Math.round(v)));
}

function rowToRule(row: Record<string, unknown>): MetricAlertRule {
  return {
    id: row.id as string,
    artifact_id: row.artifact_id as string,
    workspace_id: (row.workspace_id as string) ?? null,
    metric_id: row.metric_id as string,
    owner_id: row.owner_id as string,
    name: row.name as string,
    condition: JSON.parse(row.condition_json as string),
    schedule: row.schedule as string,
    destination_kind: row.destination_kind as AlertDestinationKind,
    destination_config: JSON.parse(row.destination_config as string),
    message: (row.message as string) ?? null,
    cooldown_seconds: row.cooldown_seconds as number,
    next_run_at: row.next_run_at as string,
    last_evaluated_at: (row.last_evaluated_at as string) ?? null,
    last_value: (row.last_value as number) ?? null,
    last_triggered_at: (row.last_triggered_at as string) ?? null,
    last_triggered_value: (row.last_triggered_value as number) ?? null,
    last_status: (row.last_status as MetricAlertRule['last_status']) ?? null,
    last_error: (row.last_error as string) ?? null,
    enabled: Boolean(row.enabled),
    on_trigger: row.on_trigger_json ? JSON.parse(row.on_trigger_json as string) : null,
    created_at: row.created_at as string,
  };
}

/** Validate + normalize an opt-in on_trigger; returns the JSON to store (or null). */
function normalizeOnTrigger(onTrigger: OnTrigger | null | undefined): string | null {
  if (!onTrigger || !onTrigger.crew) return null;
  const instruction = typeof onTrigger.instruction === 'string' ? onTrigger.instruction.trim().slice(0, 500) : undefined;
  return JSON.stringify({ crew: true, ...(instruction ? { instruction } : {}) });
}

export interface CreateRuleRequest {
  artifact_id: string;
  metric_id: string;
  name: string;
  condition: AlertCondition;
  schedule: string;
  destination: { kind: AlertDestinationKind; config: Record<string, unknown> };
  message?: string;
  cooldown_seconds?: number;
  on_trigger?: OnTrigger;
}

function validateCondition(c: unknown): { ok: true; condition: AlertCondition } | { ok: false; error: string } {
  if (!c || typeof c !== 'object') return { ok: false, error: 'condition must be an object' };
  const o = c as Record<string, unknown>;
  if (!ALERT_OPS.includes(o.op as AlertOp)) return { ok: false, error: `condition.op must be one of: ${ALERT_OPS.join(', ')}` };
  if (typeof o.value !== 'number' || !Number.isFinite(o.value)) return { ok: false, error: 'condition.value must be a number' };
  return { ok: true, condition: { op: o.op as AlertOp, value: o.value } };
}

export async function createRule(
  env: Env,
  userId: string,
  req: CreateRuleRequest
): Promise<{ rule?: MetricAlertRule; error?: string }> {
  const artifact = await getArtifactRef(env, req.artifact_id);
  if (!artifact) return { error: 'Artifact not found' };

  if (!(await isFeatureEnabled(env, 'automation.notifications', artifact.workspace_id))) {
    return { error: 'Alerts and notifications are disabled for this workspace' };
  }

  const role = await resolveAlertRole(env, artifact, userId);
  if (!role) return { error: 'Permission denied: no access to this artifact' };

  if (typeof req.name !== 'string' || !req.name.trim()) return { error: 'name is required' };

  const cron = parseCronSchedule(req.schedule || '');
  if (!cron.valid) return { error: cron.error };

  const cond = validateCondition(req.condition);
  if (!cond.ok) return { error: cond.error };

  const def = await getDefinition(env, req.artifact_id, req.metric_id);
  if (!def) return { error: `Metric "${req.metric_id}" is not defined on this artifact` };

  if (!req.destination || !ALERT_KINDS.includes(req.destination.kind)) {
    return { error: `destination.kind must be one of: ${ALERT_KINDS.join(', ')}` };
  }

  // Viewers (viewer-collaborators / plain workspace members) may only self-deliver.
  if (role === 'viewer') {
    const selfError = await checkViewerSelfDelivery(
      env,
      userId,
      req.destination.kind as JobAction,
      req.destination.config as JobConfig
    );
    if (selfError) return { error: selfError };
  }

  const destination = getDestination(req.destination.kind);
  if (!destination) return { error: `Unknown destination: ${req.destination.kind}` };
  const configError = await destination.validate(
    env,
    { artifactId: req.artifact_id, createdBy: userId, triggeredVia: 'manual' },
    req.destination.config
  );
  if (configError) return { error: configError };

  const artifactCount = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM metric_alert_rules WHERE artifact_id = ? AND enabled = 1'
  ).bind(req.artifact_id).first<{ n: number }>();
  if ((artifactCount?.n || 0) >= MAX_RULES_PER_ARTIFACT) {
    return { error: `Alert limit reached (${MAX_RULES_PER_ARTIFACT} active per artifact)` };
  }
  if (role === 'viewer') {
    const personal = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM metric_alert_rules WHERE owner_id = ? AND enabled = 1'
    ).bind(userId).first<{ n: number }>();
    if ((personal?.n || 0) >= MAX_PERSONAL_RULES_PER_USER) {
      return { error: `Personal alert limit reached (${MAX_PERSONAL_RULES_PER_USER} per user)` };
    }
  }

  // Crew-following is manager-only — a viewer's self-alert can't spend the owner's crew credits.
  if (req.on_trigger?.crew && role !== 'manager') {
    return { error: 'Only owners/editors can have the crew investigate when an alert fires.' };
  }
  const onTriggerJson = normalizeOnTrigger(req.on_trigger);

  const id = generateId('alert');
  await env.DB.prepare(
    `INSERT INTO metric_alert_rules
       (id, artifact_id, workspace_id, metric_id, owner_id, name, condition_json, schedule,
        destination_kind, destination_config, message, cooldown_seconds, next_run_at, on_trigger_json, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(
    id,
    req.artifact_id,
    artifact.workspace_id,
    req.metric_id,
    userId,
    req.name,
    JSON.stringify(cond.condition),
    req.schedule,
    req.destination.kind,
    JSON.stringify(req.destination.config),
    req.message || null,
    clampCooldown(req.cooldown_seconds),
    getNextRunTime(req.schedule),
    onTriggerJson
  ).run();

  const row = await env.DB.prepare('SELECT * FROM metric_alert_rules WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return { rule: row ? rowToRule(row) : undefined };
}

/** Managers see every alert on an artifact; everyone else sees only their own. */
export async function listRulesForArtifact(
  env: Env,
  userId: string,
  artifactId: string
): Promise<{ rules?: MetricAlertRule[]; error?: string }> {
  const artifact = await getArtifactRef(env, artifactId);
  if (!artifact) return { error: 'Artifact not found' };
  const role = await resolveAlertRole(env, artifact, userId);
  if (!role) return { error: 'Permission denied' };

  const query = role === 'manager'
    ? 'SELECT * FROM metric_alert_rules WHERE artifact_id = ? ORDER BY created_at DESC'
    : 'SELECT * FROM metric_alert_rules WHERE artifact_id = ? AND owner_id = ? ORDER BY created_at DESC';
  const params = role === 'manager' ? [artifactId] : [artifactId, userId];
  const result = await env.DB.prepare(query).bind(...params).all<Record<string, unknown>>();
  const rules = (result.results || []).map(rowToRule);
  await attachHistories(env, rules);
  return { rules };
}

/** A user's own alert rules across every artifact (the personal "My alerts" view). */
export async function listRulesForOwner(env: Env, userId: string): Promise<MetricAlertRule[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM metric_alert_rules WHERE owner_id = ? ORDER BY created_at DESC'
  ).bind(userId).all<Record<string, unknown>>();
  const rules = (result.results || []).map(rowToRule);
  await attachHistories(env, rules);
  return rules;
}

/**
 * Recent evaluated values per rule (oldest→newest, last ~24, last 30 days), for
 * a trend sparkline. One batched query over metric_alert_runs.
 */
export async function fetchHistories(env: Env, ruleIds: string[], limit = 24): Promise<Record<string, number[]>> {
  if (!ruleIds.length) return {};
  const since = Math.floor(Date.now() / 1000) - 30 * 86400;
  const placeholders = ruleIds.map(() => '?').join(',');
  const res = await env.DB.prepare(
    `SELECT rule_id, value FROM metric_alert_runs
       WHERE rule_id IN (${placeholders}) AND value IS NOT NULL AND evaluated_at >= ?
       ORDER BY evaluated_at ASC`
  ).bind(...ruleIds, since).all<{ rule_id: string; value: number }>();

  const out: Record<string, number[]> = {};
  for (const r of res.results || []) (out[r.rule_id] ||= []).push(r.value);
  for (const k of Object.keys(out)) out[k] = out[k].slice(-limit);
  return out;
}

async function attachHistories(env: Env, rules: MetricAlertRule[]): Promise<void> {
  const hist = await fetchHistories(env, rules.map((r) => r.id));
  for (const r of rules) r.history = hist[r.id] || [];
}

async function canManageRule(env: Env, rule: { owner_id: string; artifact_id: string; workspace_id: string | null }, userId: string): Promise<boolean> {
  if (rule.owner_id === userId) return true;
  const role = await resolveAlertRole(env, { id: rule.artifact_id, workspace_id: rule.workspace_id }, userId);
  return role === 'manager';
}

/** Fetch a rule by id with no permission check. Callers must gate access themselves. */
export async function getRuleById(env: Env, ruleId: string): Promise<MetricAlertRule | null> {
  const row = await env.DB.prepare('SELECT * FROM metric_alert_rules WHERE id = ?').bind(ruleId).first<Record<string, unknown>>();
  return row ? rowToRule(row) : null;
}

export async function getRule(env: Env, userId: string, ruleId: string): Promise<{ rule?: MetricAlertRule; error?: string }> {
  const row = await env.DB.prepare('SELECT * FROM metric_alert_rules WHERE id = ?').bind(ruleId).first<Record<string, unknown>>();
  if (!row) return { error: 'Alert not found' };
  const rule = rowToRule(row);
  if (!(await canManageRule(env, rule, userId))) return { error: 'Permission denied' };
  return { rule };
}

export async function updateRule(
  env: Env,
  userId: string,
  ruleId: string,
  updates: { enabled?: boolean; schedule?: string; condition?: AlertCondition; message?: string; cooldown_seconds?: number; on_trigger?: OnTrigger | null }
): Promise<{ rule?: MetricAlertRule; error?: string }> {
  const row = await env.DB.prepare('SELECT * FROM metric_alert_rules WHERE id = ?').bind(ruleId).first<Record<string, unknown>>();
  if (!row) return { error: 'Alert not found' };
  const rule = rowToRule(row);
  if (!(await canManageRule(env, rule, userId))) return { error: 'Permission denied' };

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(updates.enabled ? 1 : 0);
  }
  if (updates.schedule) {
    const cron = parseCronSchedule(updates.schedule);
    if (!cron.valid) return { error: cron.error };
    sets.push('schedule = ?', 'next_run_at = ?');
    params.push(updates.schedule, getNextRunTime(updates.schedule));
  }
  if (updates.condition) {
    const cond = validateCondition(updates.condition);
    if (!cond.ok) return { error: cond.error };
    sets.push('condition_json = ?');
    params.push(JSON.stringify(cond.condition));
  }
  if (updates.message !== undefined) {
    sets.push('message = ?');
    params.push(updates.message);
  }
  if (updates.cooldown_seconds !== undefined) {
    sets.push('cooldown_seconds = ?');
    params.push(clampCooldown(updates.cooldown_seconds));
  }
  if (updates.on_trigger !== undefined) {
    if (updates.on_trigger?.crew) {
      const role = await resolveAlertRole(env, { id: rule.artifact_id, workspace_id: rule.workspace_id }, userId);
      if (role !== 'manager') return { error: 'Only owners/editors can enable crew investigation.' };
    }
    sets.push('on_trigger_json = ?');
    params.push(normalizeOnTrigger(updates.on_trigger));
  }
  if (sets.length === 0) return { error: 'No updates provided' };

  sets.push('updated_at = ?');
  params.push(Math.floor(Date.now() / 1000));
  params.push(ruleId);

  await env.DB.prepare(`UPDATE metric_alert_rules SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  const updated = await env.DB.prepare('SELECT * FROM metric_alert_rules WHERE id = ?').bind(ruleId).first<Record<string, unknown>>();
  return { rule: updated ? rowToRule(updated) : undefined };
}

export async function deleteRule(env: Env, userId: string, ruleId: string): Promise<{ success: boolean; error?: string }> {
  const row = await env.DB.prepare('SELECT * FROM metric_alert_rules WHERE id = ?').bind(ruleId).first<Record<string, unknown>>();
  if (!row) return { success: false, error: 'Alert not found' };
  const rule = rowToRule(row);
  if (!(await canManageRule(env, rule, userId))) return { success: false, error: 'Permission denied' };
  await env.DB.prepare('DELETE FROM metric_alert_rules WHERE id = ?').bind(ruleId).run();
  return { success: true };
}

export async function getRuleEvents(
  env: Env,
  userId: string,
  ruleId: string
): Promise<{ events?: Record<string, unknown>[]; error?: string }> {
  const got = await getRule(env, userId, ruleId);
  if (got.error) return { error: got.error };
  const result = await env.DB.prepare(
    'SELECT id, evaluated_at, value, matched, delivered, destination_kind, error, message FROM metric_alert_runs WHERE rule_id = ? ORDER BY evaluated_at DESC LIMIT 50'
  ).bind(ruleId).all<Record<string, unknown>>();
  return { events: result.results || [] };
}

// --- Evaluation + delivery ---------------------------------------------------

function describeThreshold(c: AlertCondition): string {
  switch (c.op) {
    case 'gt': return `above ${c.value}`;
    case 'gte': return `at or above ${c.value}`;
    case 'lt': return `below ${c.value}`;
    case 'lte': return `at or below ${c.value}`;
    case 'eq': return `equal to ${c.value}`;
    case 'change_pct_gt': return `up more than ${c.value}%`;
    case 'change_pct_lt': return `down more than ${Math.abs(c.value)}%`;
  }
}

function buildAlertText(rule: MetricAlertRule, def: MetricDefinition, value: number): { subject: string; text: string } {
  const subject = `Alert: ${def.label} ${describeThreshold(rule.condition)}`;
  let text = `${def.label} is now ${value} (alert threshold: ${describeThreshold(rule.condition)}).`;
  if (rule.message) text += `\n\n${rule.message}`;
  return { subject, text };
}

/** Inject the alert message into a destination config without clobbering author content. */
function applyAlertMessage(
  kind: AlertDestinationKind,
  config: Record<string, unknown>,
  built: { subject: string; text: string }
): Record<string, unknown> {
  const c = { ...config };
  if (kind === 'slack' || kind === 'discord' || kind === 'telegram') {
    if (!c.customMessage) c.customMessage = built.text;
  } else if (kind === 'email') {
    if (!c.subject) c.subject = built.subject;
    if (!c.body && !c.html) c.body = built.text;
  }
  return c;
}

export interface EvalOutcome {
  value?: number;
  matched: boolean;
  delivered: boolean;
  error?: string;
  disable?: boolean;
}

/**
 * Evaluate one rule and, if it matches and cooldown permits, deliver. Re-checks
 * the creator's access first (revoked access fails closed → disable). Persists
 * an event and updates the rule's value/status fields. Pure of scheduling — the
 * runner advances next_run_at.
 */
export async function evaluateAndDeliver(
  env: Env,
  rule: MetricAlertRule,
  triggeredVia: DeliveryContext['triggeredVia']
): Promise<EvalOutcome> {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const artifact: ArtifactRef = { id: rule.artifact_id, workspace_id: rule.workspace_id };

  // Fail closed if the creator lost access to the artifact.
  if (!(await resolveAlertRole(env, artifact, rule.owner_id))) {
    await finalize(env, rule, now, { value: null, matched: false, delivered: false, status: 'failed', error: 'Access revoked' });
    return { matched: false, delivered: false, error: 'Access revoked: creator can no longer access this artifact', disable: true };
  }

  // Skip (don't disable) when notifications are turned off for the workspace,
  // so the rule resumes if re-enabled.
  if (!(await isFeatureEnabled(env, 'automation.notifications', rule.workspace_id))) {
    await finalize(env, rule, now, { value: null, matched: false, delivered: false, status: 'ok', error: null });
    return { matched: false, delivered: false, error: 'Notifications disabled for this workspace' };
  }

  const def = await getDefinition(env, rule.artifact_id, rule.metric_id);
  if (!def) {
    await finalize(env, rule, now, { value: null, matched: false, delivered: false, status: 'failed', error: 'Metric definition missing' });
    return { matched: false, delivered: false, error: 'Metric definition missing' };
  }

  const metric = await evaluateMetric(env, rule.artifact_id, rule.workspace_id ?? '', def.source);
  if ('error' in metric) {
    await finalize(env, rule, now, { value: null, matched: false, delivered: false, status: 'failed', error: metric.error });
    return { matched: false, delivered: false, error: metric.error };
  }

  const matched = evaluateCondition(rule.condition.op, rule.condition.value, metric.value, rule.last_value);
  if (!matched) {
    await finalize(env, rule, now, { value: metric.value, matched: false, delivered: false, status: 'ok', error: null });
    return { value: metric.value, matched: false, delivered: false };
  }

  // Matched — honor cooldown before delivering.
  const cooling = rule.last_triggered_at !== null
    && (nowMs - Date.parse(rule.last_triggered_at)) / 1000 < rule.cooldown_seconds;
  if (cooling) {
    await finalize(env, rule, now, { value: metric.value, matched: true, delivered: false, status: 'matched', error: null });
    return { value: metric.value, matched: true, delivered: false };
  }

  const destination = getDestination(rule.destination_kind);
  if (!destination) {
    await finalize(env, rule, now, { value: metric.value, matched: true, delivered: false, status: 'failed', error: `Unknown destination: ${rule.destination_kind}` });
    return { value: metric.value, matched: true, delivered: false, error: `Unknown destination: ${rule.destination_kind}` };
  }

  const built = buildAlertText(rule, def, metric.value);
  const config = applyAlertMessage(rule.destination_kind, rule.destination_config, built);
  let delivered = false;
  let error: string | null = null;
  try {
    const result = await destination.deliver(env, { artifactId: rule.artifact_id, createdBy: rule.owner_id, triggeredVia }, config);
    delivered = result.success;
    error = result.success ? null : result.error || 'Delivery failed';
  } catch (err) {
    error = `Delivery error: ${err}`;
  }

  await finalize(env, rule, now, {
    value: metric.value,
    matched: true,
    delivered,
    status: delivered ? 'delivered' : 'failed',
    error,
    triggered: delivered,
    message: built.text,
    deliveryDetail: { destination: rule.destination_kind, ok: delivered, ...(error ? { error } : {}) },
  });

  // Opt-in crew-following: after a real delivery, ask the artifact's crew to
  // investigate and send its summary back to the same channel. Best-effort — a
  // crew failure never affects the alert outcome.
  if (delivered && rule.on_trigger?.crew) {
    const instruction = rule.on_trigger.instruction?.trim() ||
      `${def.label} is now ${metric.value} (${describeThreshold(rule.condition)}). Investigate the likely drivers of this change and post a short summary.`;
    try {
      const crewRes = await runCrewForArtifact(env, rule.artifact_id, instruction, rule.owner_id, 'metric_alert');
      if (crewRes.ok && crewRes.resultText && CREW_FOLLOWUP_KINDS.has(rule.destination_kind)) {
        const followup = crewFollowupConfig(rule.destination_kind, rule.destination_config, crewRes.resultText);
        await destination.deliver(env, { artifactId: rule.artifact_id, createdBy: rule.owner_id, triggeredVia }, followup);
      }
    } catch {
      // Swallow — the alert already delivered; the crew run + its summary are a bonus.
    }
  }

  return { value: metric.value, matched: true, delivered, error: error || undefined };
}

// Destinations that carry a free-text message (so we can post the crew summary).
const CREW_FOLLOWUP_KINDS = new Set<AlertDestinationKind>(['slack', 'discord', 'telegram', 'email']);
const MAX_CREW_SUMMARY = 3500;

/** A message-only delivery config carrying the crew's investigation summary. */
function crewFollowupConfig(kind: AlertDestinationKind, config: Record<string, unknown>, summary: string): Record<string, unknown> {
  const text = `Crew investigation:\n\n${summary.slice(0, MAX_CREW_SUMMARY)}`;
  const c: Record<string, unknown> = { ...config, mode: 'message' };
  if (kind === 'email') {
    c.subject = 'Crew investigation';
    c.body = text;
    c.html = undefined;
  } else {
    c.customMessage = text; // slack / discord / telegram
  }
  return c;
}

interface FinalizeArgs {
  value: number | null;
  matched: boolean;
  delivered: boolean;
  status: MetricAlertRule['last_status'];
  error: string | null;
  triggered?: boolean;
  message?: string;
  deliveryDetail?: Record<string, unknown> | null;
}

/** Persist an evaluation event and update the rule's rolling state. */
async function finalize(env: Env, rule: MetricAlertRule, now: string, a: FinalizeArgs): Promise<void> {
  const sets = ['last_evaluated_at = ?', 'last_value = ?', 'last_status = ?', 'last_error = ?', 'updated_at = ?'];
  const params: (string | number | null)[] = [now, a.value, a.status, a.error, now];
  if (a.triggered) {
    sets.push('last_triggered_at = ?', 'last_triggered_value = ?');
    params.push(now, a.value);
  }
  params.push(rule.id);
  await env.DB.prepare(`UPDATE metric_alert_rules SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();

  await env.DB.prepare(
    `INSERT INTO metric_alert_runs
       (id, rule_id, artifact_id, metric_id, evaluated_at, value, matched, delivered, destination_kind, error, message, threshold, delivery_detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    generateId('mev'),
    rule.id,
    rule.artifact_id,
    rule.metric_id,
    now,
    a.value,
    a.matched ? 1 : 0,
    a.delivered ? 1 : 0,
    rule.destination_kind,
    a.error,
    a.message || null,
    rule.condition?.value ?? null,
    a.deliveryDetail ? JSON.stringify(a.deliveryDetail) : null
  ).run();
}

export async function runRuleManually(
  env: Env,
  userId: string,
  ruleId: string
): Promise<{ outcome?: EvalOutcome; error?: string }> {
  const got = await getRule(env, userId, ruleId);
  if (got.error || !got.rule) return { error: got.error || 'Alert not found' };
  return { outcome: await evaluateAndDeliver(env, got.rule, 'manual') };
}

/** Evaluate all due alert rules. Called from the scheduled handler each tick. */
export async function runDueMetricAlerts(env: Env): Promise<{ evaluated: number; triggered: number }> {
  const now = new Date().toISOString();
  const due = await env.DB.prepare(
    `SELECT * FROM metric_alert_rules
       WHERE enabled = 1 AND next_run_at <= ?
       ORDER BY next_run_at ASC LIMIT 50`
  ).bind(now).all<Record<string, unknown>>();

  let evaluated = 0;
  let triggered = 0;

  for (const row of due.results || []) {
    const rule = rowToRule(row);
    let outcome: EvalOutcome;
    try {
      outcome = await evaluateAndDeliver(env, rule, 'cron');
    } catch (err) {
      outcome = { matched: false, delivered: false, error: `Execution error: ${err}` };
    }
    evaluated++;
    if (outcome.delivered) triggered++;

    if (outcome.disable) {
      await env.DB.prepare('UPDATE metric_alert_rules SET enabled = 0 WHERE id = ?').bind(rule.id).run();
    } else {
      await env.DB.prepare('UPDATE metric_alert_rules SET next_run_at = ? WHERE id = ?')
        .bind(getNextRunTime(rule.schedule), rule.id).run();
    }
  }

  return { evaluated, triggered };
}
