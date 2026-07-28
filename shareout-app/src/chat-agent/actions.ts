import type { Env } from '../types';
import { resolveArtifactAccessForUser } from './access';
import { updateRule, deleteRule } from '../metric-alerts/rules';
import { updateJob, deleteJob, createJob } from '../scheduling/jobs';
import { addCollaboratorEmails } from '../artifacts/collaborators';
import { runCrewForArtifact } from '../crew/dispatch';
import { publishEdits } from '../data/agent/headless-edit';
import { botInsertRows, botUpdateRowById, botUpdateRowsByFilter } from '../data/tables';
import { botSetJson } from '../data/json-store';
import { buildBotDataContext } from './data-write';
import { generateArtifactHtml } from '../data/agent/build-page';
import { publishGeneratedHtml } from '../publish';

// A write the bot proposes and the user confirms with a button tap. Kept small
// and serializable — stored as JSON until the user approves it.
export type PendingAction =
  | { kind: 'alert_pause' | 'alert_resume' | 'alert_delete'; ruleId: string; label: string }
  | { kind: 'job_pause' | 'job_resume' | 'job_delete'; jobId: string; label: string }
  | { kind: 'share'; artifactId: string; artifactName: string; emails: string[]; role: 'viewer' | 'editor' }
  | { kind: 'crew'; artifactId: string; artifactName: string; instruction: string }
  | { kind: 'edit_publish'; artifactId: string; artifactName: string; conversationId: string; summary: string; files: string[] }
  | { kind: 'data_table_insert'; artifactId: string; artifactName: string; table: string; row: Record<string, unknown> }
  | { kind: 'data_table_update'; artifactId: string; artifactName: string; table: string; rowId?: string; filter?: Record<string, unknown>; changes: Record<string, unknown> }
  | { kind: 'data_json_set'; artifactId: string; artifactName: string; key: string; value: unknown; exists: boolean }
  | { kind: 'job_create'; artifactId: string; artifactName: string; schedule: string; recipients: string[]; subject: string; includePdf: boolean }
  | { kind: 'build_artifact'; name: string; prompt: string; source_file_id?: string };

// Compact one-line JSON for confirmation prompts (trimmed so a big object can't
// blow past Telegram's message limit).
function preview(value: unknown, max = 600): string {
  const s = JSON.stringify(value);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Structured approval card for rich web clients. Built from the action's own
 *  fields — no extra model calls. The plain `describeAction` string is the
 *  fallback for surfaces that don't render cards (bots). */
export interface ActionCard {
  kind: PendingAction['kind'];
  /** Verb-y headline, e.g. "Build a new page". */
  title: string;
  /** The primary subject — a page name, the new page's name, etc. */
  subject?: string;
  /** One-line human detail (spec, instruction, change summary). */
  detail?: string;
  /** Key/value or bullet rows shown under the detail. */
  lines?: string[];
  /** true → render the destructive (red) affordance. */
  danger?: boolean;
}

function kv(obj: Record<string, unknown>, max = 6): string[] {
  return Object.entries(obj).slice(0, max).map(([k, v]) => `${k}: ${preview(v, 80)}`);
}

export function describeActionRich(a: PendingAction): ActionCard {
  switch (a.kind) {
    case 'alert_pause': return { kind: a.kind, title: 'Pause alert', subject: a.label };
    case 'alert_resume': return { kind: a.kind, title: 'Resume alert', subject: a.label };
    case 'alert_delete': return { kind: a.kind, title: 'Delete alert', subject: a.label, detail: 'This can’t be undone.', danger: true };
    case 'job_pause': return { kind: a.kind, title: 'Pause schedule', subject: a.label };
    case 'job_resume': return { kind: a.kind, title: 'Resume schedule', subject: a.label };
    case 'job_delete': return { kind: a.kind, title: 'Delete schedule', subject: a.label, detail: 'This can’t be undone.', danger: true };
    case 'share': return { kind: a.kind, title: 'Share page', subject: a.artifactName, detail: `As ${a.role}`, lines: a.emails };
    case 'crew': return { kind: a.kind, title: 'Ask the crew', subject: a.artifactName, detail: a.instruction };
    case 'edit_publish': return { kind: a.kind, title: 'Edit & publish', subject: a.artifactName, detail: a.summary, lines: a.files.length ? [`Files: ${a.files.join(', ')}`] : undefined };
    case 'data_table_insert': return { kind: a.kind, title: `Add row to “${a.table}”`, subject: a.artifactName, lines: kv(a.row) };
    case 'data_table_update': return { kind: a.kind, title: `Update “${a.table}”`, subject: a.artifactName, detail: a.rowId ? `row ${a.rowId}` : `rows matching ${preview(a.filter, 80)}`, lines: kv(a.changes) };
    case 'data_json_set': return { kind: a.kind, title: `Set “${a.key}”`, subject: a.artifactName, detail: a.exists ? 'Replaces the current value.' : undefined, lines: [preview(a.value, 160)] };
    case 'job_create': return { kind: a.kind, title: 'Schedule email', subject: a.artifactName, detail: `cron ${a.schedule}${a.includePdf ? ' · PDF attached' : ''}`, lines: a.recipients };
    case 'build_artifact': return { kind: a.kind, title: 'Build a new page', subject: a.name, detail: a.prompt.length > 280 ? a.prompt.slice(0, 280) + '…' : a.prompt };
  }
}

/** Result of a confirmed build, for the streaming build widget. */
export interface BuildResult {
  text: string;
  url?: string;
  slug?: string;
  artifactId?: string;
  name: string;
}

/** Execute a confirmed build with progress callbacks, returning the published
 *  page's identity so the client can render an "Open page" affordance. */
export async function executeBuildArtifact(
  env: Env,
  userId: string,
  a: Extract<PendingAction, { kind: 'build_artifact' }>,
  onProgress?: (label: string) => void,
): Promise<BuildResult> {
  const u = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>();
  if (!u?.email) return { text: 'Couldn’t find your account to publish under.', name: a.name };
  onProgress?.('Designing your page…');
  let html: string;
  try {
    html = await generateArtifactHtml(env, a.prompt);
  } catch {
    return { text: 'The builder hit a snag generating that page. Try again?', name: a.name };
  }
  if (!html || html.length < 40) return { text: 'I couldn’t build that one — try rephrasing what you want.', name: a.name };
  onProgress?.('Publishing it live…');
  try {
    const published = await publishGeneratedHtml(env, { id: userId, email: u.email }, { name: a.name, html });
    if (a.source_file_id) {
      await env.DB.prepare(
        'INSERT INTO blob_artifact_links (blob_id, artifact_id, created_at) VALUES (?, ?, ?)'
      ).bind(a.source_file_id, published.artifact.id, new Date().toISOString()).run();
    }
    return {
      text: `Built and published ✅ ${published.deployment.url}`,
      url: published.deployment.subdomain_url || published.deployment.url,
      slug: published.deployment.slug,
      artifactId: published.artifact.id,
      name: a.name,
    };
  } catch {
    return { text: 'Generated the page but publishing failed. Try again?', name: a.name };
  }
}

/** The human-readable confirmation prompt shown above the ✅/❌ buttons. */
export function describeAction(a: PendingAction): string {
  switch (a.kind) {
    case 'alert_pause': return `Pause the alert “${a.label}”?`;
    case 'alert_resume': return `Resume the alert “${a.label}”?`;
    case 'alert_delete': return `Delete the alert “${a.label}”? This can’t be undone.`;
    case 'job_pause': return `Pause the schedule “${a.label}”?`;
    case 'job_resume': return `Resume the schedule “${a.label}”?`;
    case 'job_delete': return `Delete the schedule “${a.label}”? This can’t be undone.`;
    case 'share': return `Share “${a.artifactName}” with ${a.emails.join(', ')} as ${a.role}?`;
    case 'crew': return `Ask the crew on “${a.artifactName}” to: ${a.instruction}?`;
    case 'edit_publish':
      return `${a.summary}\n\nApply this to “${a.artifactName}” and publish it live?${a.files.length ? `\n\nFiles: ${a.files.join(', ')}` : ''}`;
    case 'data_table_insert':
      return `Add this row to “${a.table}” on “${a.artifactName}”?\n\n${preview(a.row)}`;
    case 'data_table_update': {
      const target = a.rowId ? `row ${a.rowId}` : `rows matching ${preview(a.filter)}`;
      return `Update ${target} in “${a.table}” on “${a.artifactName}” with:\n\n${preview(a.changes)}?`;
    }
    case 'data_json_set':
      return `Set “${a.key}” on “${a.artifactName}” to:\n\n${preview(a.value)}${a.exists ? '\n\nThis replaces the current value.' : ''}?`;
    case 'job_create':
      return `Schedule an email of “${a.artifactName}” (cron \`${a.schedule}\`) to ${a.recipients.join(', ')}${a.includePdf ? ', with a PDF attached' : ''}?`;
    case 'build_artifact':
      return `Build and publish a new page “${a.name}”?\n\n${a.prompt.length > 280 ? a.prompt.slice(0, 280) + '…' : a.prompt}`;
  }
}

/**
 * Execute a confirmed action AS the linked user. Re-checks permission at
 * execution time (defense in depth — never trust the stored proposal alone).
 * Returns a short user-facing result line.
 */
export async function executeAction(env: Env, userId: string, a: PendingAction): Promise<string> {
  switch (a.kind) {
    case 'alert_pause':
    case 'alert_resume': {
      const r = await updateRule(env, userId, a.ruleId, { enabled: a.kind === 'alert_resume' });
      return r.error ? `Couldn’t update that alert: ${r.error}` : `Done — alert ${a.kind === 'alert_resume' ? 'resumed' : 'paused'}.`;
    }
    case 'alert_delete': {
      const r = await deleteRule(env, userId, a.ruleId);
      return r.error ? `Couldn’t delete that alert: ${r.error}` : 'Done — alert deleted.';
    }
    case 'job_pause':
    case 'job_resume': {
      const r = await updateJob(env, userId, a.jobId, { enabled: a.kind === 'job_resume' });
      return r.error ? `Couldn’t update that schedule: ${r.error}` : `Done — schedule ${a.kind === 'job_resume' ? 'resumed' : 'paused'}.`;
    }
    case 'job_delete': {
      const r = await deleteJob(env, userId, a.jobId);
      return r.error ? `Couldn’t delete that schedule: ${r.error}` : 'Done — schedule deleted.';
    }
    case 'share': {
      const access = await resolveArtifactAccessForUser(env, a.artifactId, userId);
      if (!access || access.role !== 'owner') return 'Only the page’s owner can share it.';
      const added = await addCollaboratorEmails(env, a.artifactId, a.emails, a.role, userId);
      return added.length ? `Done — shared with ${added.join(', ')}.` : 'No one new was added.';
    }
    case 'crew': {
      const access = await resolveArtifactAccessForUser(env, a.artifactId, userId);
      if (!access || (access.role !== 'owner' && access.role !== 'editor')) return 'Only the owner or an editor can do that.';
      const res = await runCrewForArtifact(env, a.artifactId, a.instruction, userId);
      return res.ok ? (res.resultText || 'The crew finished, but didn’t leave a summary.') : res.error;
    }
    case 'edit_publish': {
      const access = await resolveArtifactAccessForUser(env, a.artifactId, userId);
      if (!access || (access.role !== 'owner' && access.role !== 'editor')) return 'Only the owner or an editor can publish changes.';
      const res = await publishEdits(env, a.artifactId, a.conversationId);
      if (!res.ok) return `Couldn’t publish that: ${res.error}`;
      return res.url ? `Published ✅ ${res.url}` : 'Published ✅';
    }
    case 'data_table_insert':
    case 'data_table_update':
    case 'data_json_set': {
      const access = await resolveArtifactAccessForUser(env, a.artifactId, userId);
      if (!access || (access.role !== 'owner' && access.role !== 'editor')) return 'Only the owner or an editor can change a page’s data.';
      const ctx = await buildBotDataContext(env, a.artifactId, access);
      if (!ctx) return 'That page doesn’t exist.';

      if (a.kind === 'data_table_insert') {
        const r = await botInsertRows(ctx, a.table, [a.row]);
        return r.error ? `Couldn’t add that row: ${r.error}` : `Done — added 1 row to “${a.table}”.`;
      }
      if (a.kind === 'data_table_update') {
        const r = a.rowId
          ? await botUpdateRowById(ctx, a.table, a.rowId, a.changes)
          : await botUpdateRowsByFilter(ctx, a.table, a.filter ?? {}, a.changes);
        if (r.error) return `Couldn’t update that: ${r.error}`;
        return `Done — updated ${r.updated} row${r.updated === 1 ? '' : 's'} in “${a.table}”.`;
      }
      const r = await botSetJson(ctx, a.key, a.value);
      return r.error ? `Couldn’t save that: ${r.error}` : `Done — saved “${a.key}”.`;
    }
    case 'job_create': {
      const access = await resolveArtifactAccessForUser(env, a.artifactId, userId);
      if (!access || (access.role !== 'owner' && access.role !== 'editor')) return 'Only the owner or an editor can schedule a page.';
      const r = await createJob(env, userId, {
        artifact_id: a.artifactId,
        action: 'email',
        schedule: a.schedule,
        config: { recipients: a.recipients, subject: a.subject, includeArtifactLink: true, renderPdf: a.includePdf },
      });
      return r.error ? `Couldn’t create that schedule: ${r.error}` : `Done — scheduled. I’ll send “${a.artifactName}” on \`${a.schedule}\`.`;
    }
    case 'build_artifact': {
      const r = await executeBuildArtifact(env, userId, a);
      return r.text;
    }
  }
}
