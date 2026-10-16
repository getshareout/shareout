/**
 * Folder sharing tools: who can see a folder, who opened what, share with one outside
 * person (optionally expiring), revoke a share. Each reuses the REST path's gate:
 * the Home folder-access read (internal workspace member), GET …/folders/{id}/activity,
 * POST …/share-person and DELETE …/grants/{id} (admin, or the folder's manager).
 */
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { queryFolderAccess } from '../pages/home/queries/folders';
import { handleListFolderActivity } from '../sharees/activity';
import { handleDeleteGrant, handleShareWithPerson } from '../sharees/grants';
import type { BotWorkspace } from '../chat-agent/access';
import {
  NOT_MEMBER, ON_FAILURE, errorText, fail, invalid, ok, readJson, resolveFolder, resolveWorkspace, str, workspaceChoiceText,
  type Args, type ToolContext, type ToolDef, type ToolResult,
} from './tool-kit';

const WORKSPACE_ARG = { type: 'string', description: 'The folder\'s workspace (id or slug). Needed when the person has more than one — ask them which.' };
const FOLDER_ARG = { type: 'string', description: 'The folder: its name or id.' };

async function pickWorkspace(ctx: ToolContext, args: Args, action: string): Promise<BotWorkspace | ToolResult> {
  const resolved = await resolveWorkspace(ctx, str(args.workspace_id, 100));
  if (resolved.notMember) return fail(NOT_MEMBER);
  if (resolved.choices) return ok(workspaceChoiceText(action, resolved.choices), { needs_workspace: true, workspaces: resolved.choices });
  if (!resolved.workspace) return invalid('Folders live in a workspace, and the person has none.');
  return resolved.workspace;
}

const isResult = (v: unknown): v is ToolResult => typeof v === 'object' && v !== null && 'content' in v;

async function pickFolder(ctx: ToolContext, args: Args, action: string): Promise<{ w: BotWorkspace; folderId: string } | ToolResult> {
  const w = await pickWorkspace(ctx, args, action);
  if (isResult(w)) return w;
  const name = str(args.folder, 200);
  if (!name) return invalid('folder is required.');
  const folder = await resolveFolder(ctx, w.id, name);
  if (folder.error || !folder.id) return invalid(folder.error ?? 'Folder not found.');
  return { w, folderId: folder.id };
}

function call(ctx: ToolContext, path: string, method: string, body?: unknown): Request {
  return new Request(`${ctx.origin}${path}`, {
    method,
    headers: { Authorization: ctx.authorization, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const AUDIENCE: Record<string, string> = {
  private: 'only the people who created or were given its pages',
  workspace: 'everyone in the workspace',
  public: 'anyone with the link',
  external: 'everyone in the workspace, plus the outside people it is shared with',
};

const folderAccess: ToolDef = {
  name: 'folder_access',
  title: 'Who can see a folder',
  description: 'Says who can see a folder of a workspace: its visibility (set on it or inherited from a parent folder) and every outside person or client it is shared with, with the grant ids revoke_share takes. Any member of the workspace may ask.',
  inputSchema: { type: 'object', properties: { folder: FOLDER_ARG, workspace_id: WORKSPACE_ARG }, required: ['folder'], additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const picked = await pickFolder(ctx, args, 'folder_access');
    if (isResult(picked)) return picked;
    // Same gate as the Home folder panel: internal members only (never an external edge).
    if (!(await getInternalWorkspaceRole(ctx.env, picked.w.id, ctx.user.id))) return fail(NOT_MEMBER);
    const access = await queryFolderAccess(ctx.env, picked.w.id, picked.folderId);
    if (!access) return invalid('That folder was not found.');
    const lines = [
      `Who can see it: ${AUDIENCE[access.access] ?? access.access}.`,
      access.inheritedFrom ? `Its visibility comes from the parent folder "${access.inheritedFrom.name}".` : `Visibility: ${access.visibility}.`,
      ...(access.grants.length
        ? ['Shared with:', ...access.grants.map((g) => `- ${g.subject_label} (${g.subject_type === 'sharee' ? 'client' : 'person'}, can ${g.capability}${g.inherited ? `, through "${g.folder_name}"` : ''}) grant ${g.id}`)]
        : ['Not shared with anyone outside the workspace.']),
    ];
    return ok(lines.join('\n'), { workspace_id: picked.w.id, folder_id: picked.folderId, ...access });
  },
};

const folderActivity: ToolDef = {
  name: 'folder_activity',
  title: 'Who opened what in a folder',
  description: 'Lists what outside people (clients, partners) opened in a shared folder and its subfolders, newest first (up to 100). For workspace admins and the folder\'s creator.',
  inputSchema: { type: 'object', properties: { folder: FOLDER_ARG, workspace_id: WORKSPACE_ARG }, required: ['folder'], additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const picked = await pickFolder(ctx, args, 'folder_activity');
    if (isResult(picked)) return picked;
    const res = await handleListFolderActivity(ctx.env, ctx.user, picked.w.id, picked.folderId);
    const body = await readJson(res);
    if (res.status === 403) return fail('Only workspace admins and the person who created the folder can see who opened it.', { status: 403, code: body.code });
    if (!res.ok) return fail(`Could not read the folder activity: ${errorText(body, res.status)}`, { status: res.status, code: body.code });
    const activity = (body.activity ?? []) as Array<{ user_email: string | null; resource_name: string | null; action: string; created_at: string }>;
    const text = activity.length
      ? activity.map((a) => `- ${a.created_at}: ${a.user_email ?? 'someone'} ${a.action} "${a.resource_name ?? 'an item'}"`).join('\n')
      : 'Nobody outside the workspace has opened anything in this folder yet.';
    return ok(text, { workspace_id: picked.w.id, folder_id: picked.folderId, activity });
  },
};

const shareWithPerson: ToolDef = {
  name: 'share_with_person',
  title: 'Share a folder or file with someone outside',
  description: [
    'Gives one outside person (a client, a partner) access to a folder (everything in it) or one file, by email. They get an invite and see it at their "shared with me" page.',
    'capability: "view" (default) or "comment". Optional expiry: expires_in_days (e.g. 7, 30, 90) or expires_at (a date); sharing again replaces the expiry.',
    'For workspace admins and the folder\'s creator. Confirm the email, the folder and the expiry with the person first.', ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      email: { type: 'string' },
      folder: { type: 'string', description: 'The folder to share: its name or id. Give folder or file_id.' },
      file_id: { type: 'string', description: 'A file (deliverable) id, dlv_…, instead of a folder.' },
      capability: { type: 'string', enum: ['view', 'comment'] },
      expires_in_days: { type: 'integer', minimum: 1, maximum: 3650 },
      expires_at: { type: 'string', description: 'ISO date-time, or YYYY-MM-DD (end of that day, UTC).' },
      workspace_id: WORKSPACE_ARG,
    },
    required: ['email'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(ctx, args) {
    const email = str(args.email, 320);
    if (!email) return invalid('email is required.');
    const fileId = str(args.file_id, 100);
    if (!fileId && !str(args.folder, 200)) return invalid('Say which folder (folder) or file (file_id) to share.');
    let w: BotWorkspace;
    let resource: { type: 'folder' | 'file'; id: string };
    if (fileId) {
      const picked = await pickWorkspace(ctx, args, 'share_with_person');
      if (isResult(picked)) return picked;
      w = picked; resource = { type: 'file', id: fileId };
    } else {
      const picked = await pickFolder(ctx, args, 'share_with_person');
      if (isResult(picked)) return picked;
      w = picked.w; resource = { type: 'folder', id: picked.folderId };
    }
    const res = await handleShareWithPerson(call(ctx, `/v1/workspaces/${w.id}/share-person`, 'POST', {
      email, resource_type: resource.type, resource_id: resource.id, capability: args.capability ?? 'view',
      ...(args.expires_in_days !== undefined ? { expires_in_days: args.expires_in_days } : {}),
      ...(args.expires_at !== undefined ? { expires_at: args.expires_at } : {}),
    }), ctx.env, ctx.user, w.id);
    const body = await readJson(res);
    if (res.status === 403) return fail(`The person cannot share this: ${errorText(body, 403)}`, { status: 403, code: body.code });
    if (body.code === 'ALREADY_MEMBER') return invalid(`${email} is already a member of "${w.name}", so they can see the workspace's folders without sharing.`);
    if (!res.ok) return fail(`It was not shared: ${errorText(body, res.status)}`, { status: res.status, code: body.code });
    const grant = (body.grant ?? {}) as { id?: string; capability?: string; expires_at?: string | null };
    const portal = resource.type === 'folder' ? `${ctx.origin}/shared?folder=${encodeURIComponent(resource.id)}` : `${ctx.origin}/shared`;
    return ok([
      `Shared with ${email} (can ${grant.capability ?? 'view'}${grant.expires_at ? `, until ${grant.expires_at}` : ', no end date'}).`,
      `They were emailed an invite; they open it at ${portal}.`,
      `To undo it: revoke_share with grant ${grant.id}.`,
    ].join('\n'), { workspace_id: w.id, grant, email, portal_url: portal });
  },
};

const revokeShare: ToolDef = {
  name: 'revoke_share',
  title: 'Stop sharing',
  description: 'Removes one share (a grant) so that person or client loses access within about a minute. Get the grant id from folder_access. For workspace admins and the folder\'s creator. Confirm with the person first.',
  inputSchema: {
    type: 'object',
    properties: { grant_id: { type: 'string' }, workspace_id: WORKSPACE_ARG },
    required: ['grant_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async run(ctx, args) {
    const grantId = str(args.grant_id, 100);
    if (!grantId) return invalid('grant_id is required.');
    const w = await pickWorkspace(ctx, args, 'revoke_share');
    if (isResult(w)) return w;
    const res = await handleDeleteGrant(call(ctx, `/v1/workspaces/${w.id}/grants/${grantId}`, 'DELETE'), ctx.env, ctx.user, w.id, grantId);
    const body = await readJson(res);
    if (res.status === 403) return fail(`The person cannot remove this share: ${errorText(body, 403)}`, { status: 403, code: body.code });
    if (res.status === 404) return invalid('That share was not found (it may already be removed).');
    if (!res.ok) return fail(`The share was not removed: ${errorText(body, res.status)}`, { status: res.status, code: body.code });
    return ok('The share is removed.', { workspace_id: w.id, grant_id: grantId, revoked: true });
  },
};

export const SHARING_TOOLS: ToolDef[] = [folderAccess, folderActivity, shareWithPerson, revokeShare];
