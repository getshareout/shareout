import type { Env } from '../../types';
import type { AccountTool } from './types';
import type { PendingAction } from '../actions';
import { listRulesForOwner, getRule } from '../../metric-alerts/rules';
import { listJobs } from '../../scheduling/jobs';
import { resolveArtifactAccessForUser } from '../access';
import { getCrew } from '../../crew/store';
import { proposeEdit } from '../../data/agent/headless-edit';

// A tool that returns this asks the agent loop to halt and show the user a
// ✅/❌ confirmation for `action` — nothing mutates until they tap Confirm.
export interface ActionProposal {
  __propose: PendingAction;
}
function propose(action: PendingAction): ActionProposal {
  return { __propose: action };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function artifactName(env: Env, artifactId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT name FROM artifacts WHERE id = ?').bind(artifactId).first<{ name: string }>();
  return row?.name?.trim() || 'page';
}

// ── Read tools (so the agent can find the id to act on) ──────────────────────

export const listAlertsTool: AccountTool = {
  name: 'list_alerts',
  description: "List the user's metric alerts (id, name, metric, enabled). Use the id with manage_alert.",
  input_schema: { type: 'object', properties: {} },
  async execute(ctx) {
    const rules = await listRulesForOwner(ctx.env, ctx.userId);
    return { alerts: rules.map((r) => ({ id: r.id, name: r.name, metric_id: r.metric_id, enabled: r.enabled })) };
  },
};

export const listJobsTool: AccountTool = {
  name: 'list_jobs',
  description: "List the user's scheduled jobs (id, action, schedule, enabled). Use the id with manage_job.",
  input_schema: { type: 'object', properties: {} },
  async execute(ctx) {
    const jobs = await listJobs(ctx.env, ctx.userId);
    return { jobs: jobs.map((j) => ({ id: j.id, action: j.action, schedule: j.schedule, enabled: j.enabled })) };
  },
};

// ── Propose tools (each returns a proposal; the user confirms before it runs) ─

export const manageAlertTool: AccountTool = {
  name: 'manage_alert',
  description: 'Pause, resume, or delete one of the user’s metric alerts. Get the id from list_alerts. Asks the user to confirm before anything changes.',
  input_schema: {
    type: 'object',
    properties: {
      rule_id: { type: 'string' },
      operation: { type: 'string', enum: ['pause', 'resume', 'delete'] },
    },
    required: ['rule_id', 'operation'],
  },
  async execute(ctx, input) {
    const ruleId = typeof input.rule_id === 'string' ? input.rule_id : '';
    const op = input.operation;
    const got = await getRule(ctx.env, ctx.userId, ruleId);
    if (got.error || !got.rule) return { error: got.error || 'Alert not found.' };
    const kind = op === 'delete' ? 'alert_delete' : op === 'resume' ? 'alert_resume' : 'alert_pause';
    return propose({ kind, ruleId, label: got.rule.name });
  },
};

export const manageJobTool: AccountTool = {
  name: 'manage_job',
  description: 'Pause, resume, or delete one of the user’s scheduled jobs. Get the id from list_jobs. Asks the user to confirm first.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string' },
      operation: { type: 'string', enum: ['pause', 'resume', 'delete'] },
    },
    required: ['job_id', 'operation'],
  },
  async execute(ctx, input) {
    const jobId = typeof input.job_id === 'string' ? input.job_id : '';
    const op = input.operation;
    // Existence + a friendly label; permission is enforced when the action runs.
    const jobs = await listJobs(ctx.env, ctx.userId);
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return { error: 'Schedule not found (or not yours).' };
    const kind = op === 'delete' ? 'job_delete' : op === 'resume' ? 'job_resume' : 'job_pause';
    return propose({ kind, jobId, label: `${job.action} · ${job.schedule}` });
  },
};

export const shareArtifactTool: AccountTool = {
  name: 'share_artifact',
  description: 'Share a page with one or more people by email (owner only). Asks the user to confirm before inviting.',
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      emails: { type: 'array', items: { type: 'string' }, description: 'Email addresses to share with.' },
      role: { type: 'string', enum: ['viewer', 'editor'], description: 'Access level (default viewer).' },
    },
    required: ['artifact_id', 'emails'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    const emails = Array.isArray(input.emails)
      ? input.emails.filter((e): e is string => typeof e === 'string').map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e))
      : [];
    const role = input.role === 'editor' ? 'editor' : 'viewer';
    if (!emails.length) return { error: 'Give me at least one valid email address.' };

    const access = await resolveArtifactAccessForUser(ctx.env, artifactId, ctx.userId);
    if (!access) return { error: 'You don’t have access to that page (or it doesn’t exist).' };
    if (access.role !== 'owner') return { error: 'Only the page’s owner can share it.' };

    return propose({ kind: 'share', artifactId, artifactName: await artifactName(ctx.env, artifactId), emails, role });
  },
};

export const askCrewTool: AccountTool = {
  name: 'ask_crew',
  description: 'Ask the page’s crew (its AI worker) to do something — investigate, refresh, summarize, or make a change. Owner/editor only. Confirms before the crew runs.',
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      instruction: { type: 'string', description: 'What to ask the crew to do.' },
    },
    required: ['artifact_id', 'instruction'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
    if (!instruction) return { error: 'Tell me what to ask the crew to do.' };

    const access = await resolveArtifactAccessForUser(ctx.env, artifactId, ctx.userId);
    if (!access) return { error: 'You don’t have access to that page (or it doesn’t exist).' };
    if (access.role !== 'owner' && access.role !== 'editor') return { error: 'Only the owner or an editor can do that.' };
    const crew = await getCrew(ctx.env, artifactId);
    if (!crew) return { error: 'That page doesn’t have a crew set up.' };

    return propose({ kind: 'crew', artifactId, artifactName: await artifactName(ctx.env, artifactId), instruction });
  },
};

export const editPageTool: AccountTool = {
  name: 'edit_page',
  description: 'Make a change to a page’s content, copy, or layout (e.g. "change the headline", "add a pricing section", "fix the wording"). Owner/editor only. Runs the page editor and asks the user to confirm before publishing the change live.',
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      instruction: { type: 'string', description: 'The change to make, in plain language.' },
    },
    required: ['artifact_id', 'instruction'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
    if (!instruction) return { error: 'Tell me what to change.' };

    const access = await resolveArtifactAccessForUser(ctx.env, artifactId, ctx.userId);
    if (!access) return { error: 'You don’t have access to that page (or it doesn’t exist).' };
    if (access.role !== 'owner' && access.role !== 'editor') return { error: 'Only the owner or an editor can change a page.' };

    const res = await proposeEdit(ctx.env, artifactId, instruction);
    if (!res.ok) return { error: res.error };
    // The agent answered without staging an edit (asked a question, declined, etc.) — relay it.
    if (!res.files.length) return { note: res.explanation };

    return propose({
      kind: 'edit_publish',
      artifactId,
      artifactName: await artifactName(ctx.env, artifactId),
      conversationId: res.conversationId,
      summary: res.explanation,
      files: res.files,
    });
  },
};
