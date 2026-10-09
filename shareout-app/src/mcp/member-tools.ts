/**
 * Workspace people tools: invite, list, resend, revoke. Each calls the same handler as
 * the REST routes under /v1/workspaces/{id}/…, so the owner/admin gate, the workspace
 * domain policy and the audit log all apply.
 */
import { handleInviteWorkspaceMembers, handleListWorkspaceMembers } from '../workspaces/members';
import { handleListWorkspaceInvites, handleResendWorkspaceInvite, handleRevokeWorkspaceInvite } from '../workspaces/invites-admin';
import { MAX_BULK_INVITES } from '../workspaces/invite';
import {
  ON_FAILURE, errorText, fail, ok, readJson, resolveWorkspace, str, workspaceChoiceText,
  type Args, type ToolContext, type ToolDef, type ToolResult,
} from './tool-kit';
import type { BotWorkspace } from '../chat-agent/access';

const CONFIRM = 'Before calling, confirm with the person the exact list of emails and the role.';
const EMAIL_RE = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[^\s<>,;:"'()[\]]+/g;

/** Emails from an array or free text ("a@x.com, b@y.com", one per line, "Ana <a@x.com>"). */
export function parseEmails(raw: unknown): string[] {
  const text = Array.isArray(raw) ? raw.map(String).join('\n') : typeof raw === 'string' ? raw : '';
  return [...new Set([...text.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase()))];
}

function call(ctx: ToolContext, path: string, method = 'GET', body?: unknown): Request {
  return new Request(`${ctx.origin}${path}`, {
    method,
    headers: { Authorization: ctx.authorization, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Resolves the workspace or returns the result to send back instead. */
async function pickWorkspace(ctx: ToolContext, args: Args, action: string): Promise<BotWorkspace | ToolResult> {
  const resolved = await resolveWorkspace(ctx, str(args.workspace_id, 100));
  if (resolved.notMember) return fail('The person is not a member of that workspace. Call list_workspaces to see the right ids.');
  if (resolved.choices) return ok(workspaceChoiceText(action, resolved.choices), { needs_workspace: true, workspaces: resolved.choices });
  if (!resolved.workspace) return fail('The person has no workspace yet, so there is nobody to invite to. They can create one in ShareOut.');
  return resolved.workspace;
}

const isResult = (v: BotWorkspace | ToolResult): v is ToolResult => 'content' in v;

const notAdmin = (w: BotWorkspace) =>
  ok(`Only owners and admins of "${w.name}" can manage people, and the person is a ${w.role}. They can ask an admin to do it.`, { forbidden: true });

async function pendingInviteId(ctx: ToolContext, workspaceId: string, email: string): Promise<string | null> {
  const row = await ctx.env.DB.prepare(
    `SELECT id FROM workspace_invite_claims WHERE workspace_id = ? AND lower(email) = ? AND claimed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).bind(workspaceId, email.toLowerCase()).first<{ id: string }>();
  return row?.id ?? null;
}

/** A copyable join link for a pending invite, without sending another email. */
async function inviteLink(ctx: ToolContext, workspaceId: string, email: string): Promise<string | null> {
  const id = await pendingInviteId(ctx, workspaceId, email);
  if (!id) return null;
  const res = await handleResendWorkspaceInvite(
    call(ctx, `/v1/workspaces/${workspaceId}/invites/${id}/resend`, 'POST', { notify: false }), ctx.env, ctx.user, workspaceId, id,
  );
  if (!res.ok) return null;
  return ((await readJson(res)).inviteUrl as string | undefined) ?? null;
}

async function memberEmails(ctx: ToolContext, workspaceId: string): Promise<Map<string, string> | null> {
  const res = await handleListWorkspaceMembers(call(ctx, `/v1/workspaces/${workspaceId}/members`), ctx.env, ctx.user, workspaceId);
  if (!res.ok) return null;
  const members = ((await readJson(res)).members ?? []) as Array<{ email: string | null; role: string }>;
  return new Map(members.filter((m) => m.email).map((m) => [m.email!.toLowerCase(), m.role]));
}

const SKIP_REASON: Record<string, string> = {
  domain_not_allowed: 'skipped: this workspace only lets in people from certain email domains',
  invalid_email: 'skipped: not a valid email address',
};

const inviteMembers: ToolDef = {
  name: 'invite_members',
  title: 'Invite people to a workspace',
  description: [
    'Invites people to a ShareOut workspace by email; they get an email to join. Only workspace owners and admins can do this.',
    'emails: a list, or one text with emails separated by commas, spaces or new lines. role: "member" (default) or "admin".',
    CONFIRM,
    'Afterwards tell the person, in their language and plain words, who was invited, who already was a member and who was skipped and why,',
    'and offer the join links in case they want to send them themselves.',
    ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      workspace_id: { type: 'string', description: 'Needed when the person has more than one workspace.' },
      emails: {
        type: ['array', 'string'],
        items: { type: 'string' },
        description: 'Email addresses to invite: a list, or one text with commas or new lines.',
      },
      role: { type: 'string', enum: ['member', 'admin'], default: 'member' },
    },
    required: ['emails'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(ctx, args) {
    const emails = parseEmails(args.emails);
    if (!emails.length) return fail('No email addresses were found in what was sent.');
    if (emails.length > MAX_BULK_INVITES) return fail(`At most ${MAX_BULK_INVITES} people can be invited at once.`);
    const role = args.role === 'admin' ? 'admin' : 'member';

    const picked = await pickWorkspace(ctx, args, 'invite_members');
    if (isResult(picked)) return picked;
    if (picked.role === 'member') return notAdmin(picked);

    // Already-members are reported, not re-invited: re-inviting would change their role.
    const existing = (await memberEmails(ctx, picked.id)) ?? new Map<string, string>();
    const toInvite = emails.filter((e) => !existing.has(e));
    const lines: string[] = [];
    const results: Array<{ email: string; status: string; reason?: string; invite_url?: string | null }> = [];
    for (const email of emails.filter((e) => existing.has(e))) {
      results.push({ email, status: 'already_member' });
      lines.push(`- ${email}: already a member (${existing.get(email)})`);
    }

    if (toInvite.length) {
      const res = await handleInviteWorkspaceMembers(
        call(ctx, `/v1/workspaces/${picked.id}/members/invite`, 'POST', { emails: toInvite, role }), ctx.env, ctx.user, picked.id,
      );
      const body = await readJson(res);
      if (!res.ok) return fail(`Nobody was invited: ${errorText(body, res.status)}`);
      for (const r of (body.results ?? []) as Array<{ email: string; status: string; reason?: string }>) {
        if (r.status === 'skipped') {
          results.push(r);
          lines.push(`- ${r.email}: ${SKIP_REASON[r.reason ?? ''] ?? 'skipped'}`);
          continue;
        }
        const link = r.status === 'invited' ? await inviteLink(ctx, picked.id, r.email) : null;
        results.push({ ...r, invite_url: link });
        lines.push(r.status === 'invited'
          ? `- ${r.email}: invited as ${role}, an email is on its way${link ? `. Join link: ${link}` : ''}`
          : `- ${r.email}: added as ${role} (they already had a ShareOut account and were notified)`);
      }
    }

    return ok([`Workspace "${picked.name}":`, ...lines, 'Tell the person the result in plain words.'].join('\n'), {
      workspace_id: picked.id, role, results,
    });
  },
};

const listMembers: ToolDef = {
  name: 'list_members',
  title: 'List workspace people',
  description: 'Lists the people in a ShareOut workspace and, for owners/admins, the invites still waiting to be accepted.',
  inputSchema: {
    type: 'object',
    properties: { workspace_id: { type: 'string' } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const picked = await pickWorkspace(ctx, args, 'list_members');
    if (isResult(picked)) return picked;
    const res = await handleListWorkspaceMembers(call(ctx, `/v1/workspaces/${picked.id}/members`), ctx.env, ctx.user, picked.id);
    const body = await readJson(res);
    if (!res.ok) return fail(`Could not list people: ${errorText(body, res.status)}`);
    const members = (body.members ?? []) as Array<{ email: string | null; name: string | null; role: string; is_agent: boolean }>;

    let invites: Array<{ email: string; expired: boolean; created_at: string }> = [];
    if (picked.role !== 'member') {
      const inv = await handleListWorkspaceInvites(ctx.env, ctx.user, picked.id);
      if (inv.ok) invites = ((await readJson(inv)).invites ?? []) as typeof invites;
    }
    const pending = new Set(invites.map((i) => i.email.toLowerCase()));
    const joined = members.filter((m) => !m.is_agent && !(m.email && pending.has(m.email.toLowerCase())));
    const lines = [
      `Workspace "${picked.name}" — ${joined.length} people:`,
      ...joined.map((m) => `- ${m.name ? `${m.name} ` : ''}${m.email ?? ''} (${m.role})`),
      ...(invites.length ? ['Waiting to accept:', ...invites.map((i) => `- ${i.email}${i.expired ? ' (invite expired — resend it)' : ''}`)] : []),
    ];
    return ok(lines.join('\n'), { workspace_id: picked.id, members: joined, pending_invites: invites });
  },
};

function inviteAction(kind: 'resend' | 'revoke'): ToolDef {
  const resend = kind === 'resend';
  return {
    name: resend ? 'resend_invite' : 'revoke_invite',
    title: resend ? 'Resend an invite' : 'Cancel an invite',
    description: resend
      ? 'Sends a pending workspace invite again (new email and a fresh join link). Owners/admins only. Confirm the email with the person first.'
      : 'Cancels a pending workspace invite so the link stops working. Owners/admins only. Confirm the email with the person first.',
    inputSchema: {
      type: 'object',
      properties: { workspace_id: { type: 'string' }, email: { type: 'string' } },
      required: ['email'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: !resend, idempotentHint: !resend, openWorldHint: resend },
    async run(ctx, args) {
      const email = parseEmails(args.email)[0];
      if (!email) return fail('A valid email address is needed.');
      const picked = await pickWorkspace(ctx, args, resend ? 'resend_invite' : 'revoke_invite');
      if (isResult(picked)) return picked;
      if (picked.role === 'member') return notAdmin(picked);
      const id = await pendingInviteId(ctx, picked.id, email);
      if (!id) return ok(`There is no pending invite for ${email} in "${picked.name}" (they may have joined already).`);

      const res = resend
        ? await handleResendWorkspaceInvite(call(ctx, `/v1/workspaces/${picked.id}/invites/${id}/resend`, 'POST', { notify: true }), ctx.env, ctx.user, picked.id, id)
        : await handleRevokeWorkspaceInvite(ctx.env, ctx.user, picked.id, id);
      const body = await readJson(res);
      if (!res.ok) return fail(`That did not work: ${errorText(body, res.status)}`);
      return resend
        ? ok(`Sent the invite to ${email} again.${body.inviteUrl ? ` Join link: ${String(body.inviteUrl)}` : ''}`, { invite_url: body.inviteUrl ?? null })
        : ok(`Cancelled the invite for ${email}. Their join link no longer works.`);
    },
  };
}

export const MEMBER_TOOLS: ToolDef[] = [inviteMembers, listMembers, inviteAction('resend'), inviteAction('revoke')];
