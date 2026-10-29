import type { Env } from '../types';
import { resolveArtifactAccessForUser } from './access';
import { updateRule, deleteRule } from '../metric-alerts/rules';
import { updateJob, deleteJob, createJob } from '../scheduling/jobs/crud';
import { addCollaboratorEmails, handleRemoveCollaborator } from '../artifacts/collaborators';
import { emailNewCollaborators } from '../artifacts/share-email';
import { handleUpdateArtifact } from '../artifacts/crud';
import { runCrewForArtifact } from '../crew/dispatch';
import { publishEdits } from '../data/agent/headless-edit';
import { createWatch } from '../metric-watch/watches';
import { presentArtifact } from '../present/present-artifact';
import { botInsertRows, botUpdateRowById, botUpdateRowsByFilter, botDeleteRowById } from '../data/tables/bot';
import { botSetJson } from '../data/json-store';
import { buildBotDataContext } from './data-write';
import { BUILD_FAILURE_COPY, BuildTruncatedError, generateArtifactHtml } from '../data/agent/build-page';
import { publishGeneratedFiles, publishGeneratedHtml } from '../publish/publish-generated-html';
import { agentFailureText, buildAgentEnabled, runPageBuild } from '../build-agent/run';
import { startBuildTrace } from '../build-agent/trace';
import { checkRateLimit, incrementRateLimit } from '../api-auth';
import { checkStorageQuota } from '../quota';
import { rateLimitMessage, storageLimitMessage } from '../publish/limits';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { t, type Locale, type LocaleCopy } from '../i18n';

// A write the bot proposes and the user confirms with a button tap. Kept small
// and serializable — stored as JSON until the user approves it.
import { executeSaveSkill } from '../skills/agent-save';
import { inviteMany, MAX_BULK_INVITES } from '../workspaces/invite';
import { isWorkspaceAdmin } from './tools/members';
import { fileInUserBuckets } from './tools/files';
import { executeReviewAction } from './review-actions';
import { upsertShareeContextFile } from '../workspace-context';
import { isKnownShareeContextUpsertError, logAgentToolFailure, userFacingClientNotesError } from './errors';
import { updateCatalogEntry, type CatalogEntryEdit } from '../catalog/edit';

export type PendingAction =
  | { kind: 'alert_pause' | 'alert_resume' | 'alert_delete'; ruleId: string; label: string }
  | { kind: 'job_pause' | 'job_resume' | 'job_delete'; jobId: string; label: string }
  | { kind: 'share'; artifactId: string; artifactName: string; emails: string[]; role: 'viewer' | 'editor' }
  | { kind: 'unshare'; artifactId: string; artifactName: string; emails: string[] }
  | { kind: 'visibility'; artifactId: string; artifactName: string; visibility: 'private' | 'workspace' }
  | { kind: 'crew'; artifactId: string; artifactName: string; instruction: string }
  | { kind: 'edit_publish'; artifactId: string; artifactName: string; conversationId: string; stagedHash: string; summary: string; files: string[]; diff?: string[] }
  | { kind: 'data_table_insert'; artifactId: string; artifactName: string; table: string; row: Record<string, unknown> }
  | { kind: 'data_table_update'; artifactId: string; artifactName: string; table: string; rowId?: string; filter?: Record<string, unknown>; changes: Record<string, unknown> }
  | { kind: 'data_table_delete'; artifactId: string; artifactName: string; table: string; rowId: string }
  | { kind: 'data_json_set'; artifactId: string; artifactName: string; key: string; value: unknown; exists: boolean }
  | { kind: 'job_create'; artifactId: string; artifactName: string; schedule: string; recipients: string[]; subject: string; includePdf: boolean }
  | { kind: 'build_artifact'; name: string; prompt: string; source_file_id?: string; workspace_id?: string }
  | { kind: 'save_skill'; workspaceId: string; name: string; markdown: string; skillArtifactId?: string; category?: string }
  | { kind: 'invite_members'; workspaceId: string; workspaceName: string; emails: string[]; role: 'member' | 'admin'; message?: string; invalid?: string[] }
  | { kind: 'version_restore'; artifactId: string; artifactName: string; versionNo: number; message?: string }
  | { kind: 'version_approve'; artifactId: string; artifactName: string; versionNo: number | null; approved: boolean }
  | { kind: 'comment_resolve'; artifactId: string; artifactName: string; commentId: string; excerpt: string; resolved: boolean }
  | { kind: 'comment_assign'; artifactId: string; artifactName: string; commentId: string; excerpt: string; assignee: string | null }
  | { kind: 'watch_metric'; artifactId: string; artifactName: string; spec: Record<string, unknown> }
  | { kind: 'present_artifact'; artifactId: string; artifactName: string }
  | { kind: 'client_notes'; workspaceId: string; clientId: string; clientName: string; note: string; content: string }
  | { kind: 'catalog_edit'; workspaceId: string; entryId: string; entryTitle: string; edit: CatalogEntryEdit; certified: boolean };

// Staged-edit diff for plain-text prompts, trimmed so it can't blow past Telegram's message limit.
function diffText(diff: string[], max = 2000): string {
  const s = diff.join('\n');
  return s.length > max ? s.slice(0, max) + '\n… (more changes not shown)' : s;
}

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

// One line per field a catalog edit sets, for the confirmation card and prompt.
function catalogEditLines(edit: CatalogEntryEdit, removed: string): string[] {
  return Object.entries(edit).map(([k, v]) => {
    if (v === null || (Array.isArray(v) && !v.length)) return `${k}: ${removed}`;
    if (Array.isArray(v)) return `${k}: ${v.join(', ')}`;
    const s = String(v);
    return `${k}: ${s.length > 200 ? s.slice(0, 200) + '…' : s}`;
  });
}

export function describeActionRich(a: PendingAction, locale: Locale = 'en'): ActionCard {
  if (locale === 'es') return describeActionRichEs(a);
  switch (a.kind) {
    case 'alert_pause': return { kind: a.kind, title: 'Pause alert', subject: a.label };
    case 'alert_resume': return { kind: a.kind, title: 'Resume alert', subject: a.label };
    case 'alert_delete': return { kind: a.kind, title: 'Delete alert', subject: a.label, detail: 'This can’t be undone.', danger: true };
    case 'job_pause': return { kind: a.kind, title: 'Pause schedule', subject: a.label };
    case 'job_resume': return { kind: a.kind, title: 'Resume schedule', subject: a.label };
    case 'job_delete': return { kind: a.kind, title: 'Delete schedule', subject: a.label, detail: 'This can’t be undone.', danger: true };
    case 'share': return { kind: a.kind, title: 'Share page', subject: a.artifactName, detail: `As ${a.role} · they get an email with the link`, lines: a.emails };
    case 'unshare': return { kind: a.kind, title: 'Stop sharing', subject: a.artifactName, lines: a.emails, danger: true };
    case 'visibility': return { kind: a.kind, title: a.visibility === 'workspace' ? 'Open to the whole workspace' : 'Make private', subject: a.artifactName, detail: a.visibility === 'workspace' ? 'Every workspace member can open it.' : 'Only you and the people it is shared with can open it.' };
    case 'crew': return { kind: a.kind, title: 'Ask the crew', subject: a.artifactName, detail: a.instruction };
    case 'edit_publish': return { kind: a.kind, title: 'Edit & publish', subject: a.artifactName, detail: a.summary, lines: a.files.length ? [`Files: ${a.files.join(', ')}`, ...(a.diff ?? [])] : undefined };
    case 'data_table_insert': return { kind: a.kind, title: `Add row to “${a.table}”`, subject: a.artifactName, lines: kv(a.row) };
    case 'data_table_update': return { kind: a.kind, title: `Update “${a.table}”`, subject: a.artifactName, detail: a.rowId ? `row ${a.rowId}` : `rows matching ${preview(a.filter, 80)}`, lines: kv(a.changes) };
    case 'data_table_delete': return { kind: a.kind, title: `Delete a row from “${a.table}”`, subject: a.artifactName, detail: `row ${a.rowId} · This can’t be undone.`, danger: true };
    case 'data_json_set': return { kind: a.kind, title: `Set “${a.key}”`, subject: a.artifactName, detail: a.exists ? 'Replaces the current value.' : undefined, lines: [preview(a.value, 160)] };
    case 'job_create': return { kind: a.kind, title: 'Schedule email', subject: a.artifactName, detail: `cron ${a.schedule}${a.includePdf ? ' · PDF attached' : ''}`, lines: a.recipients };
    case 'build_artifact': return { kind: a.kind, title: 'Build a new page', subject: a.name, detail: a.prompt.length > 280 ? a.prompt.slice(0, 280) + '…' : a.prompt };
    case 'save_skill': return { kind: a.kind, title: a.skillArtifactId ? 'Update team skill' : 'Save as team skill', subject: a.name, detail: `${a.markdown.length} characters of markdown`, lines: [a.markdown.slice(0, 200) + (a.markdown.length > 200 ? '…' : '')] };
    case 'invite_members': return {
      kind: a.kind,
      title: `Invite ${a.emails.length} ${a.emails.length === 1 ? 'person' : 'people'}`,
      subject: a.workspaceName,
      detail: `As ${a.role}${a.message ? ` · “${a.message}”` : ''}${a.invalid?.length ? ` · skipping invalid: ${a.invalid.join(', ')}` : ''}`,
      lines: a.emails.length > 8 ? [...a.emails.slice(0, 7), `+${a.emails.length - 7} more`] : a.emails,
    };
    case 'version_restore': return { kind: a.kind, title: `Bring back version ${a.versionNo}`, subject: a.artifactName, detail: 'Saved as a new version; nothing is deleted.' };
    case 'version_approve': return { kind: a.kind, title: a.approved ? 'Approve version' : 'Withdraw approval', subject: a.artifactName, detail: a.versionNo ? `Version ${a.versionNo}` : 'The live version' };
    case 'comment_resolve': return { kind: a.kind, title: a.resolved ? 'Resolve comment' : 'Reopen comment', subject: a.artifactName, detail: a.excerpt };
    case 'comment_assign': return { kind: a.kind, title: a.assignee ? `Assign comment to ${a.assignee}` : 'Unassign comment', subject: a.artifactName, detail: a.excerpt };
    case 'watch_metric': return { kind: a.kind, title: 'Watch a metric', subject: a.artifactName, lines: kv(a.spec) };
    case 'present_artifact': return { kind: a.kind, title: 'Make a deck', subject: a.artifactName, detail: 'Generates a private slides artifact from this page with AI.' };
    case 'client_notes': return { kind: a.kind, title: `Save notes on ${a.clientName}`, subject: a.note, detail: 'Replaces the file. Every workspace member’s assistant reads these notes.', lines: [a.content.slice(0, 300) + (a.content.length > 300 ? '…' : '')] };
    case 'catalog_edit': return { kind: a.kind, title: 'Edit catalog entry', subject: a.entryTitle, detail: a.certified ? 'It is certified: after this edit it shows as changed since certification.' : undefined, lines: catalogEditLines(a.edit, '(removed)') };
  }
}

const ROLE_ES = { viewer: 'lector', editor: 'editor' } as const;
const ROLE_MEMBER_ES = { member: 'miembro', admin: 'admin' } as const;
const NO_UNDO_ES = 'No se puede deshacer.';

function describeActionRichEs(a: PendingAction): ActionCard {
  switch (a.kind) {
    case 'alert_pause': return { kind: a.kind, title: 'Pausar alerta', subject: a.label };
    case 'alert_resume': return { kind: a.kind, title: 'Reactivar alerta', subject: a.label };
    case 'alert_delete': return { kind: a.kind, title: 'Borrar alerta', subject: a.label, detail: NO_UNDO_ES, danger: true };
    case 'job_pause': return { kind: a.kind, title: 'Pausar envío programado', subject: a.label };
    case 'job_resume': return { kind: a.kind, title: 'Reactivar envío programado', subject: a.label };
    case 'job_delete': return { kind: a.kind, title: 'Borrar envío programado', subject: a.label, detail: NO_UNDO_ES, danger: true };
    case 'share': return { kind: a.kind, title: 'Compartir artefacto', subject: a.artifactName, detail: `Como ${ROLE_ES[a.role]} · les llega un mail con el link`, lines: a.emails };
    case 'unshare': return { kind: a.kind, title: 'Dejar de compartir', subject: a.artifactName, lines: a.emails, danger: true };
    case 'visibility': return { kind: a.kind, title: a.visibility === 'workspace' ? 'Abrir a todo el espacio' : 'Hacer privado', subject: a.artifactName, detail: a.visibility === 'workspace' ? 'Todos los miembros del espacio pueden abrirlo.' : 'Solo vos y las personas con las que lo compartiste pueden abrirlo.' };
    case 'crew': return { kind: a.kind, title: 'Pedirle al agente', subject: a.artifactName, detail: a.instruction };
    case 'edit_publish': return { kind: a.kind, title: 'Cambiar y publicar', subject: a.artifactName, detail: a.summary, lines: a.files.length ? [`Archivos: ${a.files.join(', ')}`, ...(a.diff ?? [])] : undefined };
    case 'data_table_insert': return { kind: a.kind, title: `Agregar fila a “${a.table}”`, subject: a.artifactName, lines: kv(a.row) };
    case 'data_table_update': return { kind: a.kind, title: `Actualizar “${a.table}”`, subject: a.artifactName, detail: a.rowId ? `fila ${a.rowId}` : `filas que coinciden con ${preview(a.filter, 80)}`, lines: kv(a.changes) };
    case 'data_table_delete': return { kind: a.kind, title: `Borrar una fila de “${a.table}”`, subject: a.artifactName, detail: `fila ${a.rowId} · ${NO_UNDO_ES}`, danger: true };
    case 'data_json_set': return { kind: a.kind, title: `Guardar “${a.key}”`, subject: a.artifactName, detail: a.exists ? 'Reemplaza el valor actual.' : undefined, lines: [preview(a.value, 160)] };
    case 'job_create': return { kind: a.kind, title: 'Programar mail', subject: a.artifactName, detail: `cron ${a.schedule}${a.includePdf ? ' · con PDF adjunto' : ''}`, lines: a.recipients };
    case 'build_artifact': return { kind: a.kind, title: 'Armar un artefacto nuevo', subject: a.name, detail: a.prompt.length > 280 ? a.prompt.slice(0, 280) + '…' : a.prompt };
    case 'save_skill': return { kind: a.kind, title: a.skillArtifactId ? 'Actualizar skill del equipo' : 'Guardar como skill del equipo', subject: a.name, detail: `${a.markdown.length} caracteres de markdown`, lines: [a.markdown.slice(0, 200) + (a.markdown.length > 200 ? '…' : '')] };
    case 'invite_members': return {
      kind: a.kind,
      title: `Invitar a ${a.emails.length} ${a.emails.length === 1 ? 'persona' : 'personas'}`,
      subject: a.workspaceName,
      detail: `Como ${ROLE_MEMBER_ES[a.role]}${a.message ? ` · “${a.message}”` : ''}${a.invalid?.length ? ` · se saltean los inválidos: ${a.invalid.join(', ')}` : ''}`,
      lines: a.emails.length > 8 ? [...a.emails.slice(0, 7), `+${a.emails.length - 7} más`] : a.emails,
    };
    case 'version_restore': return { kind: a.kind, title: `Volver a la versión ${a.versionNo}`, subject: a.artifactName, detail: 'Se guarda como una versión nueva; no se borra nada.' };
    case 'version_approve': return { kind: a.kind, title: a.approved ? 'Aprobar versión' : 'Retirar aprobación', subject: a.artifactName, detail: a.versionNo ? `Versión ${a.versionNo}` : 'La versión publicada' };
    case 'comment_resolve': return { kind: a.kind, title: a.resolved ? 'Resolver comentario' : 'Reabrir comentario', subject: a.artifactName, detail: a.excerpt };
    case 'comment_assign': return { kind: a.kind, title: a.assignee ? `Asignar comentario a ${a.assignee}` : 'Quitar la asignación', subject: a.artifactName, detail: a.excerpt };
    case 'watch_metric': return { kind: a.kind, title: 'Vigilar una métrica', subject: a.artifactName, lines: kv(a.spec) };
    case 'present_artifact': return { kind: a.kind, title: 'Armar una presentación', subject: a.artifactName, detail: 'Genera con IA una presentación privada a partir de este artefacto.' };
    case 'client_notes': return { kind: a.kind, title: `Guardar notas sobre ${a.clientName}`, subject: a.note, detail: 'Reemplaza el archivo. El asistente de todos los miembros del espacio lee estas notas.', lines: [a.content.slice(0, 300) + (a.content.length > 300 ? '…' : '')] };
    case 'catalog_edit': return { kind: a.kind, title: 'Editar entrada del catálogo', subject: a.entryTitle, detail: a.certified ? 'Está certificada: después de este cambio figura como modificada desde la certificación.' : undefined, lines: catalogEditLines(a.edit, '(se quita)') };
  }
}

function describeActionEs(a: PendingAction): string {
  switch (a.kind) {
    case 'alert_pause': return `¿Pauso la alerta “${a.label}”?`;
    case 'alert_resume': return `¿Reactivo la alerta “${a.label}”?`;
    case 'alert_delete': return `¿Borro la alerta “${a.label}”? ${NO_UNDO_ES}`;
    case 'job_pause': return `¿Pauso el envío programado “${a.label}”?`;
    case 'job_resume': return `¿Reactivo el envío programado “${a.label}”?`;
    case 'job_delete': return `¿Borro el envío programado “${a.label}”? ${NO_UNDO_ES}`;
    case 'share': return `¿Comparto “${a.artifactName}” con ${a.emails.join(', ')} como ${ROLE_ES[a.role]}? Les llega un mail con el link.`;
    case 'unshare': return `¿Dejo de compartir “${a.artifactName}” con ${a.emails.join(', ')}?`;
    case 'visibility':
      return a.visibility === 'workspace'
        ? `¿Dejo que todos los miembros del espacio abran “${a.artifactName}”?`
        : `¿Hago privado “${a.artifactName}”? Solo vos y las personas con las que lo compartiste van a poder abrirlo.`;
    case 'crew': return `¿Le pido al agente de “${a.artifactName}” que haga esto: ${a.instruction}?`;
    case 'edit_publish':
      return `${a.summary}\n\n¿Aplico esto en “${a.artifactName}” y lo publico?${a.files.length ? `\n\nArchivos: ${a.files.join(', ')}` : ''}${a.diff?.length ? `\n\nCambios:\n${diffText(a.diff)}` : ''}`;
    case 'data_table_insert':
      return `¿Agrego esta fila a “${a.table}” en “${a.artifactName}”?\n\n${preview(a.row)}`;
    case 'data_table_update': {
      const target = a.rowId ? `la fila ${a.rowId}` : `las filas que coinciden con ${preview(a.filter)}`;
      return `¿Actualizo ${target} de “${a.table}” en “${a.artifactName}” con esto?\n\n${preview(a.changes)}`;
    }
    case 'data_table_delete':
      return `¿Borro la fila ${a.rowId} de “${a.table}” en “${a.artifactName}”? ${NO_UNDO_ES}`;
    case 'data_json_set':
      return `¿Guardo “${a.key}” en “${a.artifactName}” con este valor?\n\n${preview(a.value)}${a.exists ? '\n\nReemplaza el valor actual.' : ''}`;
    case 'job_create':
      return `¿Programo un mail de “${a.artifactName}” (cron \`${a.schedule}\`) para ${a.recipients.join(', ')}${a.includePdf ? ', con un PDF adjunto' : ''}?`;
    case 'build_artifact':
      return `¿Armo y publico un artefacto nuevo, “${a.name}”?\n\n${a.prompt.length > 280 ? a.prompt.slice(0, 280) + '…' : a.prompt}`;
    case 'save_skill':
      return `¿${a.skillArtifactId ? 'Actualizo' : 'Guardo'} la skill del equipo “${a.name}” en la Biblioteca del espacio?`;
    case 'invite_members':
      return `¿Invito a ${a.emails.join(', ')} a “${a.workspaceName}” como ${ROLE_MEMBER_ES[a.role]}?`;
    case 'version_restore':
      return `¿Vuelvo “${a.artifactName}” a la versión ${a.versionNo}? Se guarda como una versión nueva; no se borra nada.`;
    case 'version_approve':
      return `¿${a.approved ? 'Apruebo' : 'Retiro la aprobación de'} ${a.versionNo ? `la versión ${a.versionNo}` : 'la versión publicada'} de “${a.artifactName}”?`;
    case 'comment_resolve':
      return `¿${a.resolved ? 'Resuelvo' : 'Reabro'} este comentario en “${a.artifactName}”?\n\n“${a.excerpt}”`;
    case 'comment_assign':
      return `¿${a.assignee ? `Le asigno a ${a.assignee}` : 'Le quito la asignación a'} este comentario en “${a.artifactName}”?\n\n“${a.excerpt}”`;
    case 'watch_metric': return `¿Vigilo esta métrica en “${a.artifactName}”?\n\n${preview(a.spec)}`;
    case 'present_artifact': return `¿Genero con IA una presentación privada a partir de “${a.artifactName}”?`;
    case 'client_notes':
      return `¿Guardo estas notas de “${a.note}” sobre ${a.clientName}? Reemplazan el archivo y las lee el asistente de todo el espacio.\n\n${a.content.slice(0, 600)}${a.content.length > 600 ? '…' : ''}`;
    case 'catalog_edit':
      return `¿Edito la entrada del catálogo “${a.entryTitle}”?${a.certified ? ' Está certificada: va a figurar como modificada desde la certificación.' : ''}\n\n${catalogEditLines(a.edit, '(se quita)').join('\n')}`;
  }
}

/** Result of a confirmed build, for the streaming build widget. */
export interface BuildResult {
  /** false when nothing was published — the client shows the card as failed. */
  ok: boolean;
  text: string;
  url?: string;
  slug?: string;
  artifactId?: string;
  name: string;
}

const BUILD_ACTION_COPY: LocaleCopy<{ noAccount: string; designing: string; publishing: string; published: (url: string) => string }> = {
  en: {
    noAccount: 'Couldn’t find your account to publish under.',
    designing: 'Designing your page…',
    publishing: 'Publishing it live…',
    published: (url) => `Built and published ✅ ${url}`,
  },
  es: {
    noAccount: 'No encontré tu cuenta para publicar la página.',
    designing: 'Diseñando tu página…',
    publishing: 'Publicándola…',
    published: (url) => `Lista y publicada ✅ ${url}`,
  },
};

/** Execute a confirmed build with progress callbacks, returning the published
 *  page's identity so the client can render an "Open page" affordance. */
export async function executeBuildArtifact(
  env: Env,
  userId: string,
  a: Extract<PendingAction, { kind: 'build_artifact' }>,
  onProgress?: (label: string) => void,
  locale: Locale = 'en',
): Promise<BuildResult> {
  const copy = t(locale, BUILD_ACTION_COPY);
  const fail = t(locale, BUILD_FAILURE_COPY);
  const failed = (text: string): BuildResult => ({ ok: false, text, name: a.name });
  const u = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>();
  if (!u?.email) return failed(copy.noAccount);
  const rate = await checkRateLimit(env, userId, 'publish', u.email);
  if (!rate.allowed) return failed(rateLimitMessage(rate.reset));
  if (await buildAgentEnabled(env, a.workspace_id ?? null)) {
    const built = await executeBuildArtifactWithAgent(env, userId, u.email, a, onProgress, locale);
    if (built) return built;
  }
  onProgress?.(copy.designing);
  let html: string;
  const meter = { workspaceId: a.workspace_id ?? null, userId, kind: 'page_build', source: 'assistant' };
  const trace = startBuildTrace(env, meter, 'one_shot');
  try {
    // The workspace's brand and house style only reach the page when the user is a member of it.
    const briefWs = a.workspace_id && await getInternalWorkspaceRole(env, a.workspace_id, userId) ? a.workspace_id : null;
    html = await generateArtifactHtml(env, a.prompt, meter, briefWs, trace);
  } catch (err) {
    // A model error or a cut-off page already closed the trace; this covers the rest.
    await trace.finish('failed', { errorCode: 'EXCEPTION', errorMessage: err instanceof Error ? err.message : String(err) });
    return failed(err instanceof BuildTruncatedError ? fail.truncated : fail.snag);
  }
  if (!html || html.length < 40) {
    await trace.finish('failed', { errorCode: 'EMPTY', errorMessage: 'the model returned no page' });
    return failed(fail.empty);
  }
  const quota = await checkStorageQuota(env, userId, [{ path: 'index.html', content: html, mime: 'text/html' }]);
  if (!quota.allowed) {
    await trace.finish('failed', { errorCode: 'STORAGE_QUOTA', errorMessage: 'the page did not fit the storage quota' });
    return failed(storageLimitMessage(quota));
  }
  onProgress?.(copy.publishing);
  try {
    const workspaceId = a.workspace_id && await getInternalWorkspaceRole(env, a.workspace_id, userId) ? a.workspace_id : null;
    const published = await publishGeneratedHtml(env, { id: userId, email: u.email }, { name: a.name, html, workspaceId, visibility: 'private' });
    await trace.finish('published', { artifactId: published.artifact.id });
    await incrementRateLimit(env, userId, 'publish', u.email);
    await linkSourceFile(env, userId, workspaceId, a.source_file_id, published.artifact.id);
    return {
      ok: true,
      text: copy.published(published.deployment.url),
      url: published.deployment.subdomain_url || published.deployment.url,
      slug: published.deployment.slug,
      artifactId: published.artifact.id,
      name: a.name,
    };
  } catch (err) {
    await trace.finish('failed', { errorCode: 'PUBLISH_FAILED', errorMessage: err instanceof Error ? err.message : String(err) });
    return failed(fail.publishFailed);
  }
}

async function linkSourceFile(env: Env, userId: string, workspaceId: string | null, fileId: string | undefined, artifactId: string): Promise<void> {
  if (!fileId || !(await fileInUserBuckets(env, userId, workspaceId, fileId))) return;
  await env.DB.prepare('INSERT INTO blob_artifact_links (blob_id, artifact_id, created_at) VALUES (?, ?, ?)')
    .bind(fileId, artifactId, new Date().toISOString()).run();
}

/** Agent on (BUILD_AGENT or the workspace flag): the page is written, checked and fixed by a tool-using agent. Null when no AI provider is configured (the one-shot builder takes over). */
async function executeBuildArtifactWithAgent(
  env: Env,
  userId: string,
  email: string,
  a: Extract<PendingAction, { kind: 'build_artifact' }>,
  onProgress: ((label: string) => void) | undefined,
  locale: Locale,
): Promise<BuildResult | null> {
  const copy = t(locale, BUILD_ACTION_COPY);
  const fail = t(locale, BUILD_FAILURE_COPY);
  const workspaceId = a.workspace_id && await getInternalWorkspaceRole(env, a.workspace_id, userId) ? a.workspace_id : null;
  let counted = false;
  const result = await runPageBuild({
    env, user: { id: userId, email }, locale, prompt: a.prompt, isPublic: false, onProgress, briefWorkspaceId: workspaceId,
    meter: { workspaceId: a.workspace_id ?? null, userId, kind: 'page_build', source: 'assistant' },
    // Assistant builds are always private, so there is no draft stage: the same publish serves every round.
    publish: async (files, o) => {
      const quota = await checkStorageQuota(env, userId, files.map(({ path, content, mime }) => ({ path, content, mime })));
      if (!quota.allowed) return { ok: false, error: storageLimitMessage(quota) };
      try {
        const published = await publishGeneratedFiles(env, { id: userId, email }, { name: a.name, files, slug: o.slug, workspaceId, visibility: 'private' });
        if (!counted) await incrementRateLimit(env, userId, 'publish', email);
        counted = true;
        return { ok: true, page: { url: published.deployment.url, slug: published.deployment.slug, artifactId: published.artifact.id, extra: published.deployment.subdomain_url } };
      } catch {
        return { ok: false, error: fail.publishFailed };
      }
    },
  });
  if (!result) return null;
  if (!result.ok) return { ok: false, text: agentFailureText(result, locale), name: a.name };
  await linkSourceFile(env, userId, workspaceId, a.source_file_id, result.page.artifactId);
  return { ok: true, text: copy.published(result.page.url), url: (result.page.extra as string | undefined) || result.page.url, slug: result.page.slug, artifactId: result.page.artifactId, name: a.name };
}

/** The human-readable confirmation prompt shown above the ✅/❌ buttons. */
export function describeAction(a: PendingAction, locale: Locale = 'en'): string {
  if (locale === 'es') return describeActionEs(a);
  switch (a.kind) {
    case 'alert_pause': return `Pause the alert “${a.label}”?`;
    case 'alert_resume': return `Resume the alert “${a.label}”?`;
    case 'alert_delete': return `Delete the alert “${a.label}”? This can’t be undone.`;
    case 'job_pause': return `Pause the schedule “${a.label}”?`;
    case 'job_resume': return `Resume the schedule “${a.label}”?`;
    case 'job_delete': return `Delete the schedule “${a.label}”? This can’t be undone.`;
    case 'share': return `Share “${a.artifactName}” with ${a.emails.join(', ')} as ${a.role}? They get an email with the link.`;
    case 'unshare': return `Stop sharing “${a.artifactName}” with ${a.emails.join(', ')}?`;
    case 'visibility':
      return a.visibility === 'workspace'
        ? `Let every member of the workspace open “${a.artifactName}”?`
        : `Make “${a.artifactName}” private? Only you and the people it is shared with can open it.`;
    case 'crew': return `Ask the crew on “${a.artifactName}” to: ${a.instruction}?`;
    case 'edit_publish':
      return `${a.summary}\n\nApply this to “${a.artifactName}” and publish it live?${a.files.length ? `\n\nFiles: ${a.files.join(', ')}` : ''}${a.diff?.length ? `\n\nChanges:\n${diffText(a.diff)}` : ''}`;
    case 'data_table_insert':
      return `Add this row to “${a.table}” on “${a.artifactName}”?\n\n${preview(a.row)}`;
    case 'data_table_update': {
      const target = a.rowId ? `row ${a.rowId}` : `rows matching ${preview(a.filter)}`;
      return `Update ${target} in “${a.table}” on “${a.artifactName}” with:\n\n${preview(a.changes)}?`;
    }
    case 'data_table_delete':
      return `Delete row ${a.rowId} from “${a.table}” on “${a.artifactName}”? This can’t be undone.`;
    case 'data_json_set':
      return `Set “${a.key}” on “${a.artifactName}” to:\n\n${preview(a.value)}${a.exists ? '\n\nThis replaces the current value.' : ''}?`;
    case 'job_create':
      return `Schedule an email of “${a.artifactName}” (cron \`${a.schedule}\`) to ${a.recipients.join(', ')}${a.includePdf ? ', with a PDF attached' : ''}?`;
    case 'build_artifact':
      return `Build and publish a new page “${a.name}”?\n\n${a.prompt.length > 280 ? a.prompt.slice(0, 280) + '…' : a.prompt}`;
    case 'save_skill':
      return `${a.skillArtifactId ? 'Update' : 'Save'} the team skill “${a.name}” in your workspace Library?`;
    case 'invite_members':
      return `Invite ${a.emails.join(', ')} to “${a.workspaceName}” as ${a.role}?`;
    case 'version_restore':
      return `Bring “${a.artifactName}” back to version ${a.versionNo}? It is saved as a new version; nothing is deleted.`;
    case 'version_approve':
      return `${a.approved ? 'Approve' : 'Withdraw your approval of'} ${a.versionNo ? `version ${a.versionNo}` : 'the live version'} of “${a.artifactName}”?`;
    case 'comment_resolve':
      return `${a.resolved ? 'Resolve' : 'Reopen'} this comment on “${a.artifactName}”?\n\n“${a.excerpt}”`;
    case 'comment_assign':
      return `${a.assignee ? `Assign this comment to ${a.assignee}` : 'Unassign this comment'} on “${a.artifactName}”?\n\n“${a.excerpt}”`;
    case 'watch_metric': return `Watch this metric on “${a.artifactName}”?\n\n${preview(a.spec)}`;
    case 'present_artifact': return `Generate a private slides deck from “${a.artifactName}” with AI?`;
    case 'client_notes':
      return `Save these notes (“${a.note}”) on ${a.clientName}? They replace the file and every workspace member’s assistant reads them.\n\n${a.content.slice(0, 600)}${a.content.length > 600 ? '…' : ''}`;
    case 'catalog_edit':
      return `Edit the catalog entry “${a.entryTitle}”?${a.certified ? ' It is certified: it will show as changed since certification.' : ''}\n\n${catalogEditLines(a.edit, '(removed)').join('\n')}`;
  }
}

// The linked user as the REST handlers expect it, so a confirmed action runs the same
// permission checks as the Studio panel.
async function linkedUser(env: Env, userId: string) {
  const row = await env.DB.prepare('SELECT email, username FROM users WHERE id = ?').bind(userId).first<{ email: string | null; username: string | null }>();
  return { id: userId, email: row?.email ?? null, username: row?.username ?? null };
}

/**
 * Execute a confirmed action AS the linked user. Re-checks permission at
 * execution time (defense in depth — never trust the stored proposal alone).
 * Returns a short user-facing result line.
 */
export async function executeAction(env: Env, userId: string, a: PendingAction, locale: Locale = 'en'): Promise<string> {
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
      if (!access || (access.role !== 'owner' && access.role !== 'editor')) return 'Only the page’s owner or an editor can share it.';
      const added = await addCollaboratorEmails(env, a.artifactId, a.emails, a.role, userId);
      if (!added.length) return 'No one new was added — they already have access.';
      const mail = await emailNewCollaborators(env, userId, a.artifactId, added, a.role);
      const done = `Done — shared with ${added.join(', ')}.`;
      if (!mail.failed.length) return `${done} I emailed them the link and how to sign in.`;
      const why = mail.rate_limited ? 'this page reached today’s email limit' : 'the email didn’t go out';
      const unsent = mail.failed.map((f) => f.email).join(', ');
      return `${done} I couldn’t email ${unsent} (${why}) — send them the link yourself${mail.url ? `: ${mail.url}` : '.'}`;
    }
    case 'unshare': {
      const user = await linkedUser(env, userId);
      const removed: string[] = [];
      for (const email of a.emails) {
        const res = await handleRemoveCollaborator(new Request(`https://internal/v1/artifacts/${a.artifactId}/collaborators/${encodeURIComponent(email)}`, { method: 'DELETE' }), env, user, a.artifactId, email);
        if (res.status === 403) return 'Only the page’s owner or an editor can change who it is shared with.';
        const body = (await res.json().catch(() => ({}))) as { removed?: boolean; error?: string };
        if (!res.ok) return `Couldn’t remove ${email}: ${body.error ?? `HTTP ${res.status}`}.`;
        if (body.removed) removed.push(email);
      }
      return removed.length ? `Done — ${removed.join(', ')} can no longer open it through a share.` : 'None of them had it shared with them.';
    }
    case 'visibility': {
      const user = await linkedUser(env, userId);
      const res = await handleUpdateArtifact(new Request(`https://internal/v1/artifacts/${a.artifactId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: a.visibility }),
      }), env, user, a.artifactId);
      const body = (await res.json().catch(() => ({}))) as { visibility?: string; message?: string; error?: string };
      if (res.status === 403) return body.error && body.error !== 'Forbidden' ? `Couldn’t change it: ${body.error}.` : 'Only the page’s owner or an editor can change who can open it.';
      if (!res.ok) return `Couldn’t change it: ${body.error ?? `HTTP ${res.status}`}.`;
      if (res.status === 202 && body.message) return body.message;
      return a.visibility === 'workspace' ? 'Done — every member of the workspace can open it now.' : 'Done — it’s private: only you and the people it is shared with can open it.';
    }
    case 'crew': {
      const access = await resolveArtifactAccessForUser(env, a.artifactId, userId);
      if (!access || access.role !== 'owner') return 'Only the page’s owner can ask its crew.';
      const res = await runCrewForArtifact(env, a.artifactId, a.instruction, userId);
      return res.ok ? (res.resultText || 'The crew finished, but didn’t leave a summary.') : res.error;
    }
    case 'watch_metric': {
      const r = await createWatch(env, userId, a.artifactId, a.spec);
      return r.error ? `Couldn’t set that watch: ${r.error}` : 'Done — watching that metric.';
    }
    case 'present_artifact': {
      const r = await presentArtifact(env, userId, a.artifactId);
      return r.ok ? `Done — your deck: ${r.url}` : `Couldn’t make the deck: ${r.error}`;
    }
    case 'edit_publish': {
      const access = await resolveArtifactAccessForUser(env, a.artifactId, userId);
      if (!access || (access.role !== 'owner' && access.role !== 'editor')) return 'Only the owner or an editor can publish changes.';
      const res = await publishEdits(env, a.artifactId, a.conversationId, a.stagedHash, userId);
      if (!res.ok) return `Couldn’t publish that: ${res.error}`;
      return res.url ? `Published ✅ ${res.url}` : 'Published ✅';
    }
    case 'data_table_insert':
    case 'data_table_update':
    case 'data_table_delete':
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
      if (a.kind === 'data_table_delete') {
        const r = await botDeleteRowById(ctx, a.table, a.rowId);
        return r.error ? `Couldn’t delete that row: ${r.error}` : `Done — deleted the row from “${a.table}”.`;
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
      const r = await executeBuildArtifact(env, userId, a, undefined, locale);
      return r.text;
    }
    case 'save_skill':
      return await executeSaveSkill(env, userId, a);
    case 'invite_members':
      return await executeInviteMembers(env, userId, a);
    case 'version_restore':
    case 'version_approve':
    case 'comment_resolve':
    case 'comment_assign':
      return await executeReviewAction(env, userId, a);
    case 'client_notes':
      return await executeClientNotes(env, userId, a);
    case 'catalog_edit':
      return await executeCatalogEdit(env, userId, a);
  }
}

async function executeCatalogEdit(env: Env, userId: string, a: Extract<PendingAction, { kind: 'catalog_edit' }>): Promise<string> {
  if (!(await getInternalWorkspaceRole(env, a.workspaceId, userId))) return 'Only a member of this workspace can edit its catalog.';
  const r = await updateCatalogEntry(env, a.workspaceId, a.entryId, a.edit, { id: userId, kind: 'agent' });
  if (!r.ok) return `Couldn’t save that: ${r.message}`;
  return r.changed.length ? `Done — updated ${r.changed.join(', ')} on “${r.entry.title}”.` : 'Nothing changed — the entry already says that.';
}

async function executeClientNotes(env: Env, userId: string, a: Extract<PendingAction, { kind: 'client_notes' }>): Promise<string> {
  const role = await getInternalWorkspaceRole(env, a.workspaceId, userId);
  if (role !== 'owner' && role !== 'admin') return 'Only a workspace admin can edit client notes.';
  try {
    const err = await upsertShareeContextFile(env, a.workspaceId, a.clientId, a.note, a.content, userId);
    if (err) {
      if (!isKnownShareeContextUpsertError(err)) logAgentToolFailure(env, { tool: 'set_client_notes', userId }, new Error(err));
      return userFacingClientNotesError(err);
    }
  } catch (e) {
    logAgentToolFailure(env, { tool: 'set_client_notes', userId }, e);
    return userFacingClientNotesError(e);
  }
  return `Done — saved “${a.note}” for ${a.clientName}.`;
}

async function executeInviteMembers(env: Env, userId: string, a: Extract<PendingAction, { kind: 'invite_members' }>): Promise<string> {
  if (!(await isWorkspaceAdmin(env, a.workspaceId, userId))) return 'Only workspace owners and admins can invite people.';
  const lines: string[] = [];
  for (let i = 0; i < a.emails.length; i += MAX_BULK_INVITES) {
    const { results } = await inviteMany(env, a.workspaceId, userId, a.emails.slice(i, i + MAX_BULK_INVITES), a.role, a.message);
    for (const r of results) {
      const what = {
        invited: r.email_sent === false ? `invited — email not sent, share this link: ${r.invite_url ?? '(see Admin → Members)'}` : 'invited',
        added: 'added (already had an account)',
        already_member: 'already a member',
        invalid_email: 'not a valid email',
        domain_not_allowed: 'domain not allowed in this workspace',
      }[r.code];
      lines.push(`${r.email}: ${what}`);
    }
  }
  return `Done.\n${lines.join('\n')}`;
}
