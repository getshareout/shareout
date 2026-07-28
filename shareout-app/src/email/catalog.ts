// ─────────────────────────────────────────────────────────────────────────────
// THE EMAIL CATALOG — one place for every lifecycle email.
//
// Each entry declares, together: its category (controls suppression/unsubscribe),
// its audience (who may receive it), its trigger (where it fires — doc only), and
// its build() (subject + copy). To add an email: add one entry here, then call
//   dispatchLifecycleEmail(env, { type: '<key>', toUserId, data })
// from the trigger site. The gateway handles audience/prefs/suppression/rendering.
//
// Keep copy on-voice (Design/brand/voice.md): smart friend, concrete verbs, no
// exclamation in success copy, never the banned words. Blue/CTA = one action.
// ─────────────────────────────────────────────────────────────────────────────
import type { Env } from '../types';
import type { EmailCategory } from './preferences';
import type { AudienceSegment } from './audience';
import { escapeHtml } from './layout';
import { colors, fonts, radius } from '../design-system/tokens';

export type EmailAudienceTag = 'ANY' | 'EXTERNAL' | AudienceSegment;

export interface EmailContext {
  env: Env;
  baseUrl: string;
}

export interface BuiltEmail {
  subject: string;
  heading: string;
  /** Inner HTML — caller-escaped. Wrapped by renderEmailLayout. */
  bodyHtml: string;
  preheader?: string;
  cta?: { label: string; href: string };
  footerNote?: string;
  /** Body for the plaintext twin (falls back to a tag-stripped bodyHtml). */
  bodyText?: string;
  /** Full plaintext override (skips the auto twin). */
  text?: string;
}

export interface EmailTemplate<D = Record<string, unknown>> {
  category: EmailCategory;
  audiences: EmailAudienceTag[];
  /** Human note: where/when this fires. Self-documents the catalog. */
  trigger: string;
  /** Builds subject + copy from typed data. Omitted = not yet wired (P2+). */
  build?: (data: D, ctx: EmailContext) => BuiltEmail;
}

// ── small copy helpers ───────────────────────────────────────────────────────
const p = (s: string) => `<p style="margin:0 0 14px">${s}</p>`;

function codeBlock(code: string): string {
  return `<div style="font-family:${fonts.mono};font-size:34px;font-weight:700;letter-spacing:8px;color:${colors.text};background:${colors.surface};border:1px solid ${colors.border};border-radius:${radius.sm};padding:18px;text-align:center">${escapeHtml(code)}</div>`;
}

// ── data shapes per email ────────────────────────────────────────────────────
export interface OtpData { code: string }
export interface InviteData { workspaceName: string; inviterName: string; claimCode: string; claimTtlDays: number }
export interface AddedToWorkspaceData { workspaceName: string; inviterName: string }
export interface CommentData { fromName: string; verb: string; title: string; snippet: string; url: string }
export interface ActionItemAssignedData { fromName: string; title: string; snippet: string; url: string; dueStr?: string | null }
export interface ActionItemResolvedData { fromName: string; title: string; snippet: string; url: string }
export interface PublishApprovalData { kind: 'request' | 'approved' | 'declined' }
export interface CrewApprovalData { count: number }
export interface ShareData {
  artifactName: string;
  artifactDescription?: string | null;
  viewUrl: string;
  thumbnailUrl: string;
  sharerName?: string | null;
  customMessage?: string | null;
  role: 'none' | 'viewer' | 'editor';
}
export interface FirstPublishData { pageName: string; url: string }
export interface MemberJoinedData { memberName: string; workspaceName: string }
export interface AccessRequestData { requesterEmail: string; pageName: string; url: string }
export interface FirstViewData { pageName: string; url: string }
export interface WeeklyDigestData { views: number; comments: number; published: number }
export interface WorkspaceDigestData {
  workspaceName: string;
  homeUrl: string;
  /** Optional LLM sentence; sections stand alone when absent. */
  narrative?: string;
  updated: { name: string; description: string | null; url: string }[];
  topViewed: { name: string; url: string; views: number }[];
  openComments: number;
  staleData: { name: string; url: string }[];
}
export interface UnusedArtifactsReportData { workspaceName: string; count: number; titles: string[]; homeUrl: string }
export interface SlidesDeckOpenedData { deckName: string; recipientLabel?: string | null; viewerEmail?: string | null; url: string }
export interface SupportReplyData { subject: string; body: string; ticketUrl?: string | null }
export interface SupportResolvedData { subject: string }
export interface AssetDeliveryData { collectionName: string; downloadUrl: string; fileCount: number; senderName?: string | null; expiresAt?: string | null }
export interface AssetDeliveryOpenedData { collectionName: string; viewerEmail?: string | null }
export interface WorkspaceWelcomeData { workspaceName: string; inviterName: string; role: string }
export interface InviteAcceptedData { memberName: string; workspaceName: string }
export interface AccessApprovedData { pageName: string; url: string }
export interface ModerationApprovedData { pageName: string; url: string }
export interface AccessDeclinedData { pageName: string }

function shareRoleLine(role: ShareData['role']): string {
  if (role === 'editor') return "You've been added as an editor — open it to start co-editing.";
  if (role === 'viewer') return "You've been given access to view this page.";
  return '';
}

// ── THE CATALOG ──────────────────────────────────────────────────────────────
export const EMAILS = {
  // ===== transactional =====
  otp: {
    category: 'transactional',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'startEmailOtp() — user requests an email sign-in code.',
    build: ({ code }: OtpData) => ({
      subject: `${code} is your ShareOut code`,
      preheader: 'Your ShareOut sign-in code (expires in 10 minutes).',
      heading: 'Your sign-in code',
      bodyHtml: p('Enter this code to finish signing in. It expires in 10 minutes.') + codeBlock(code),
      footerNote: "If you didn't request this, you can ignore this email.",
      bodyText: `Your ShareOut sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
    }),
  } satisfies EmailTemplate<OtpData>,

  welcome: {
    category: 'transactional',
    audiences: ['ANY'],
    trigger: 'First sign-in (OTP or Google OAuth) — scheduleWelcomeEmail().',
    build: (_d: Record<string, unknown>, { baseUrl }) => ({
      subject: 'Welcome to ShareOut — your home is ready',
      preheader: 'Your home and a few starter examples are ready.',
      heading: 'Your home is ready',
      bodyHtml:
        p('ShareOut turns an idea into a live, shareable page with real data — no servers, no setup. Publish a dashboard, a form, a poll, a whole app, in one click.') +
        p('We added a few examples to your home to get you going — each shows one feature and is yours to open, edit, or delete. Start with the <strong>Start Here</strong> page.'),
      cta: { label: 'Open your home', href: `${baseUrl}/app` },
      footerNote: "You're receiving this because you just created a ShareOut account.",
      bodyText:
        'ShareOut turns an idea into a live, shareable page with real data — no servers. We added a few examples to your home to get you going; each shows one feature and is yours to edit or delete. Start with the "Start Here" page.',
    }),
  } satisfies EmailTemplate,

  account_deletion: {
    category: 'transactional',
    audiences: ['ANY'],
    trigger: 'TODO(P2): account deletion path.',
  } satisfies EmailTemplate,

  unused_artifacts_report: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'Monthly janitor sweep — runUnusedArtifactSweep flags a workspace with 3+ pages unopened for 90+ days. Sent to workspace admins/owners.',
    build: ({ workspaceName, count, titles, homeUrl }: UnusedArtifactsReportData) => ({
      subject: `${count} pages in ${workspaceName} haven't been opened in months`,
      preheader: 'A quick cleanup suggestion for your workspace — nothing has been deleted.',
      heading: 'Time for a tidy-up?',
      bodyHtml:
        p(`${count} published page${count === 1 ? '' : 's'} in <strong>${escapeHtml(workspaceName)}</strong> ${count === 1 ? "hasn't" : "haven't"} been opened by anyone in 90+ days.`) +
        p('A few worth a look:') +
        `<ul style="margin:0 0 14px;padding-left:20px">${titles.map((tt) => `<li>${escapeHtml(tt)}</li>`).join('')}</ul>` +
        p('Open your workspace to archive them in one click — they move to trash and stay recoverable for 30 days before they’re removed for good.') +
        p('Starred pages are never included — star anything worth keeping and the janitor will skip it.'),
      cta: { label: 'Review in your workspace', href: homeUrl },
      footerNote: 'You’re receiving this as a workspace admin. Nothing has been deleted — this is only a suggestion.',
      bodyText: `${count} published pages in ${workspaceName} haven't been opened in 90+ days: ${titles.join(', ')}. Open ${homeUrl} to archive them (recoverable for 30 days). Starred pages are never included — star anything worth keeping and the janitor will skip it.`,
    }),
  } satisfies EmailTemplate<UnusedArtifactsReportData>,

  support_reply: {
    category: 'transactional',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'Staff sends a reply on an email-channel support ticket — deliverReply().',
    build: ({ subject, body, ticketUrl }: SupportReplyData) => ({
      subject: `Re: ${subject}`,
      preheader: 'A reply to your support request.',
      heading: 'Reply from ShareOut support',
      bodyHtml: body.split('\n').filter(Boolean).map((line) => p(escapeHtml(line))).join(''),
      ...(ticketUrl ? { cta: { label: 'View your request', href: ticketUrl } } : {}),
      footerNote: 'Reply to this email to continue the conversation.',
      bodyText: body,
    }),
  } satisfies EmailTemplate<SupportReplyData>,

  support_resolved: {
    category: 'transactional',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'Staff marks a support ticket resolved — status handler.',
    build: ({ subject }: SupportResolvedData) => ({
      subject: `Resolved: ${subject}`,
      preheader: 'Your support request is marked resolved.',
      heading: 'Marked resolved',
      bodyHtml: p('We’ve marked your support request resolved. If it’s not quite right, just reply and we’ll pick it back up.'),
      footerNote: 'Reply to this email to reopen the conversation.',
      bodyText: 'We have marked your support request resolved. If it is not quite right, just reply and we will pick it back up.',
    }),
  } satisfies EmailTemplate<SupportResolvedData>,

  new_device: {
    category: 'transactional',
    audiences: ['ANY'],
    trigger: 'TODO(P2): new-device sign-in.',
  } satisfies EmailTemplate,

  workspace_invite: {
    category: 'transactional',
    audiences: ['EXTERNAL', 'ANY'],
    trigger: 'sendInviteEmail() — workspace owner invites a member.',
    build: ({ workspaceName, inviterName, claimCode, claimTtlDays }: InviteData, { baseUrl }) => {
      const joinUrl = `${baseUrl}/invite/${encodeURIComponent(claimCode)}`;
      // Agent footnote: humans click the button; Claude users can still claim by code.
      const agentNote =
        `<p style="margin:0;color:${colors.textTertiary};font-size:12px;line-height:1.5">Using ShareOut in Claude? Claim with code <span style="font-family:${fonts.mono};color:${colors.textSecondary}">${escapeHtml(claimCode)}</span>.</p>`;
      return {
        subject: `You're invited to ${workspaceName} on ShareOut`,
        preheader: `${inviterName} invited you to ${workspaceName} on ShareOut.`,
        heading: `Join ${workspaceName}`,
        bodyHtml:
          p(`${escapeHtml(inviterName)} invited you to <strong>${escapeHtml(workspaceName)}</strong> on ShareOut — a place to build and publish pages with real data. Open it and you're in.`) +
          agentNote,
        cta: { label: `Join ${workspaceName}`, href: joinUrl },
        footerNote: `This invite is single-use and expires in ${claimTtlDays} days. If you didn't expect it, you can ignore this email.`,
        bodyText: `${inviterName} invited you to ${workspaceName} on ShareOut.\n\nJoin ${workspaceName}: ${joinUrl}\n\nUsing ShareOut in Claude? Claim with code ${claimCode}.\n\nThis invite is single-use and expires in ${claimTtlDays} days.`,
      };
    },
  } satisfies EmailTemplate<InviteData>,

  added_to_workspace: {
    category: 'transactional',
    audiences: ['ANY'],
    trigger: 'workspaces/invite.ts — an existing user is added to a workspace.',
    build: ({ workspaceName, inviterName }: AddedToWorkspaceData, { baseUrl }) => ({
      subject: `You've been added to ${workspaceName} on ShareOut`,
      preheader: `${inviterName} added you to ${workspaceName}.`,
      heading: `You've been added to ${workspaceName}`,
      bodyHtml: p(`${escapeHtml(inviterName)} added you to the <strong>${escapeHtml(workspaceName)}</strong> workspace on ShareOut. You can build and publish pages there now.`),
      cta: { label: 'Open ShareOut', href: `${baseUrl}/home` },
      bodyText: `${inviterName} added you to the ${workspaceName} workspace on ShareOut. You can build and publish pages there now.`,
    }),
  } satisfies EmailTemplate<AddedToWorkspaceData>,

  workspace_welcome: {
    category: 'transactional',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'First activation of a pre-created invitee (google-oauth / email OTP) — welcomes them into the workspace they were invited to.',
    build: ({ workspaceName, inviterName, role }: WorkspaceWelcomeData, { baseUrl }) => ({
      subject: `You're in — welcome to ${workspaceName}`,
      preheader: `You now have access to ${workspaceName} on ShareOut.`,
      heading: `Welcome to ${workspaceName}`,
      bodyHtml: p(`${escapeHtml(inviterName)} added you to <strong>${escapeHtml(workspaceName)}</strong> as ${escapeHtml(role)}. Everything the team has built is inside — open it and take a look around.`),
      cta: { label: `Open ${workspaceName}`, href: `${baseUrl}/home` },
      bodyText: `${inviterName} added you to ${workspaceName} as ${role}. Open ${workspaceName}: ${baseUrl}/home`,
    }),
  } satisfies EmailTemplate<WorkspaceWelcomeData>,

  invite_accepted: {
    category: 'transactional',
    audiences: ['ANY'],
    trigger: 'resolveClaim success (web accept or agent claim) — tells the inviter their invite was accepted.',
    build: ({ memberName, workspaceName }: InviteAcceptedData, { baseUrl }) => ({
      subject: `${memberName} joined ${workspaceName}`,
      preheader: `${memberName} accepted your invite to ${workspaceName}.`,
      heading: `${memberName} joined ${workspaceName}`,
      bodyHtml: p(`${escapeHtml(memberName)} accepted your invite and is now in <strong>${escapeHtml(workspaceName)}</strong>.`),
      cta: { label: 'Open workspace', href: `${baseUrl}/home` },
      bodyText: `${memberName} accepted your invite and is now in ${workspaceName}. Open workspace: ${baseUrl}/home`,
    }),
  } satisfies EmailTemplate<InviteAcceptedData>,

  access_approved: {
    category: 'transactional',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'Owner approves an access request — artifacts/access-requests.ts.',
    build: ({ pageName, url }: AccessApprovedData) => ({
      subject: `You're in — ${pageName}`,
      preheader: `You now have access to ${pageName}.`,
      heading: `You have access to ${pageName}`,
      bodyHtml: p(`Your request went through — you can open <strong>${escapeHtml(pageName)}</strong> now.`),
      cta: { label: 'Open page', href: url },
      bodyText: `You now have access to ${pageName}. Open page: ${url}`,
    }),
  } satisfies EmailTemplate<AccessApprovedData>,

  moderation_approved: {
    category: 'transactional',
    audiences: ['ANY'],
    trigger: 'A held page clears the safety review and its visibility is restored — moderation/notify.ts.',
    build: ({ pageName, url }: ModerationApprovedData) => ({
      subject: `${pageName} passed review`,
      preheader: `${pageName} cleared the safety check and is public again.`,
      heading: `${pageName} is public`,
      bodyHtml: p(`<strong>${escapeHtml(pageName)}</strong> passed the automated safety review and is live again — nothing else you need to do.`),
      cta: { label: 'Open page', href: url },
      bodyText: `${pageName} passed review and is now public. Open page: ${url}`,
    }),
  } satisfies EmailTemplate<ModerationApprovedData>,

  access_declined: {
    category: 'transactional',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'Owner declines an access request — artifacts/access-requests.ts.',
    build: ({ pageName }: AccessDeclinedData) => ({
      subject: 'About your access request',
      preheader: `An update on your request to view ${pageName}.`,
      heading: 'About your request',
      bodyHtml: p(`The owner didn't grant access to <strong>${escapeHtml(pageName)}</strong> this time. If you think you need it, reach out to them directly.`),
      bodyText: `The owner didn't grant access to ${pageName} this time. If you think you need it, reach out to them directly.`,
    }),
  } satisfies EmailTemplate<AccessDeclinedData>,

  asset_delivery: {
    category: 'transactional',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'Assets lens — a user sends a collection of files to a client.',
    build: ({ collectionName, downloadUrl, fileCount, senderName, expiresAt }: AssetDeliveryData) => {
      const who = senderName?.trim();
      const n = `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
      const exp = expiresAt ? `<p style="margin:14px 0 0;color:${colors.textSecondary};font-size:13px">This link is available until ${escapeHtml(new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}.</p>` : '';
      return {
        subject: who ? `${who} sent you files: ${collectionName}` : `Files for you: ${collectionName}`,
        preheader: `${n} ready to download.`,
        heading: collectionName,
        bodyHtml:
          p(`${who ? `<strong>${escapeHtml(who)}</strong> sent you ` : 'You have '}${n} to download.`) +
          exp,
        cta: { label: 'Download files', href: downloadUrl },
        bodyText: `${who ? `${who} sent you ` : 'You have '}${n} to download: ${downloadUrl}${expiresAt ? `\n\nAvailable until ${new Date(expiresAt).toDateString()}.` : ''}`,
      };
    },
  } satisfies EmailTemplate<AssetDeliveryData>,

  asset_delivery_opened: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'download-page.ts — the recipient opens a delivery link for the first time.',
    build: ({ collectionName, viewerEmail }: AssetDeliveryOpenedData, { baseUrl }) => {
      const who = viewerEmail?.trim();
      return {
        subject: who ? `${who} opened ${collectionName}` : `Your delivery ${collectionName} was opened`,
        preheader: `${who || 'Someone'} just opened your delivery.`,
        heading: 'Your delivery was opened',
        bodyHtml: p(`${who ? `<strong>${escapeHtml(who)}</strong>` : 'Someone'} just opened your delivery <strong>${escapeHtml(collectionName)}</strong> and can download the files.`),
        cta: { label: 'Open your assets', href: `${baseUrl}/home` },
        bodyText: `${who || 'Someone'} just opened your delivery "${collectionName}".`,
      };
    },
  } satisfies EmailTemplate<AssetDeliveryOpenedData>,

  // ===== product =====
  comment_notify: {
    category: 'product',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'notifyCommentTargets() — @mention or reply on an artifact comment.',
    build: ({ fromName, verb, title, snippet, url }: CommentData) => ({
      subject: `${fromName} ${verb} on ${title}`,
      preheader: `${fromName}: ${snippet}`,
      heading: `${fromName} ${verb}`,
      bodyHtml:
        `<p style="margin:0 0 14px">On <strong>${escapeHtml(title)}</strong>:</p>` +
        `<blockquote style="margin:0;border-left:3px solid ${colors.borderStrong};padding:2px 0 2px 14px;color:${colors.textSecondary}">${escapeHtml(snippet)}</blockquote>`,
      cta: { label: 'View the conversation', href: url },
      bodyText: `${fromName} ${verb} on "${title}":\n\n"${snippet}"`,
    }),
  } satisfies EmailTemplate<CommentData>,

  action_item_assigned: {
    category: 'product',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'notifyCommentTargets() — a comment is assigned to you as an action item.',
    build: ({ fromName, title, snippet, url, dueStr }: ActionItemAssignedData) => ({
      subject: `${fromName} assigned you an action item on ${title}`,
      preheader: `${fromName}: ${snippet}`,
      heading: `${fromName} assigned you an action item`,
      bodyHtml:
        `<p style="margin:0 0 14px">On <strong>${escapeHtml(title)}</strong>:</p>` +
        `<blockquote style="margin:0;border-left:3px solid ${colors.borderStrong};padding:2px 0 2px 14px;color:${colors.textSecondary}">${escapeHtml(snippet)}</blockquote>` +
        (dueStr ? `<p style="margin:14px 0 0;color:${colors.textSecondary}">Due ${escapeHtml(dueStr)}</p>` : ''),
      cta: { label: 'View action item', href: url },
      bodyText: `${fromName} assigned you an action item on "${title}":\n\n"${snippet}"${dueStr ? `\n\nDue ${dueStr}` : ''}`,
    }),
  } satisfies EmailTemplate<ActionItemAssignedData>,

  action_item_resolved: {
    category: 'product',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'dispatchActionItemResolved() — someone completed the action item you assigned.',
    build: ({ fromName, title, snippet, url }: ActionItemResolvedData) => ({
      subject: `${fromName} completed your action item on ${title}`,
      preheader: `${fromName}: ${snippet}`,
      heading: `${fromName} completed your action item`,
      bodyHtml:
        `<p style="margin:0 0 14px">On <strong>${escapeHtml(title)}</strong>:</p>` +
        `<blockquote style="margin:0;border-left:3px solid ${colors.borderStrong};padding:2px 0 2px 14px;color:${colors.textSecondary}">${escapeHtml(snippet)}</blockquote>`,
      cta: { label: 'Review', href: url },
      bodyText: `${fromName} completed your action item on "${title}":\n\n"${snippet}"`,
    }),
  } satisfies EmailTemplate<ActionItemResolvedData>,

  artifact_share: {
    category: 'product',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'POST share — a user shares a page with people.',
    build: (d: ShareData) => {
      const intro = d.sharerName ? `${d.sharerName} shared a page with you.` : 'A page was shared with you.';
      const desc = d.artifactDescription?.trim();
      const msg = d.customMessage?.trim();
      const role = shareRoleLine(d.role);
      return {
        subject: d.sharerName ? `${d.sharerName} shared: ${d.artifactName}` : `Shared with you: ${d.artifactName}`,
        preheader: desc || intro,
        heading: d.artifactName,
        bodyHtml:
          `<p style="margin:0 0 16px">${escapeHtml(intro)}</p>` +
          `<img src="${escapeHtml(d.thumbnailUrl)}" width="496" alt="Preview of ${escapeHtml(d.artifactName)}" style="display:block;width:100%;height:auto;border-radius:12px;border:1px solid ${colors.border};margin:0 0 4px" />` +
          (desc ? `<p style="margin:14px 0 0;color:${colors.textSecondary}">${escapeHtml(desc)}</p>` : '') +
          (msg ? `<div style="margin:16px 0 0;background:${colors.surface};border-left:3px solid ${colors.borderStrong};border-radius:8px;padding:12px 14px;color:${colors.textSecondary}">${escapeHtml(msg)}</div>` : '') +
          (role ? `<p style="margin:16px 0 0;color:${colors.textSecondary}">${escapeHtml(role)}</p>` : ''),
        cta: { label: 'Open page', href: d.viewUrl },
        bodyText: [intro, '', d.artifactName, desc || '', msg ? `\n"${msg}"` : '', role ? `\n${role}` : ''].filter((x) => x !== '').join('\n'),
      };
    },
  } satisfies EmailTemplate<ShareData>,

  publish_approval: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'publish-approval — request to approvers, decision to requester.',
    build: ({ kind }: PublishApprovalData, { baseUrl }) => {
      const cta = { label: kind === 'request' ? 'Review the request' : 'Open ShareOut', href: `${baseUrl}/home` };
      if (kind === 'request') {
        const body = 'A teammate wants to publish a page publicly and chose you as an approver.';
        return { subject: 'A teammate needs your approval to publish a page', preheader: 'A teammate chose you to approve a public page.', heading: 'Approval needed', bodyHtml: p(body), cta, bodyText: body };
      }
      if (kind === 'approved') {
        const body = "Your teammates approved publishing your page. It's now going live, pending the automatic safety check.";
        return { subject: 'Your page was approved to publish', preheader: 'Your page was approved', heading: 'Your page was approved', bodyHtml: p(body), cta, bodyText: body };
      }
      const body = 'Your request to publish your page publicly was declined. It stays visible to your workspace.';
      return { subject: 'Your publish request was declined', preheader: 'Your publish request was declined', heading: 'Your publish request was declined', bodyHtml: p(body), cta, bodyText: body };
    },
  } satisfies EmailTemplate<PublishApprovalData>,

  crew_approval: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'notifyOwnerPendingApprovals() — crew actions await owner approval.',
    build: ({ count }: CrewApprovalData, { baseUrl }) => {
      const n = count === 1 ? '1 action' : `${count} actions`;
      const body = `Your ShareOut crew prepared ${n} that ${count === 1 ? 'needs' : 'need'} your approval before ${count === 1 ? 'it runs' : 'they run'}.`;
      return {
        subject: `Your crew has ${n} awaiting approval`,
        preheader: body,
        heading: `${n} awaiting your approval`,
        bodyHtml: p(body),
        cta: { label: 'Review and approve', href: `${baseUrl}/home` },
        bodyText: body,
      };
    },
  } satisfies EmailTemplate<CrewApprovalData>,

  access_request: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'access-requests.ts — someone asks for access (email fallback when the owner has no Telegram).',
    build: ({ requesterEmail, pageName, url }: AccessRequestData) => ({
      subject: `${requesterEmail} asked for access to ${pageName}`,
      preheader: `${requesterEmail} wants access to ${pageName}.`,
      heading: 'Someone wants access to your page',
      bodyHtml:
        p(`<strong>${escapeHtml(requesterEmail)}</strong> asked for access to your page <strong>${escapeHtml(pageName)}</strong>.`) +
        p('Open the page to approve or decline.'),
      cta: { label: 'Review the request', href: url },
      bodyText: `${requesterEmail} asked for access to your page "${pageName}". Open the page to approve or decline: ${url}`,
    }),
  } satisfies EmailTemplate<AccessRequestData>,

  slides_deck_opened: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'slides/links.ts — a recipient opens a tracked deck link (B2B P2).',
    build: ({ deckName, recipientLabel, viewerEmail, url }: SlidesDeckOpenedData) => {
      const who = recipientLabel?.trim() || viewerEmail?.trim() || 'Someone';
      return {
        subject: `${who} opened ${deckName}`,
        preheader: `${who} just opened your deck.`,
        heading: 'Your deck was opened',
        bodyHtml:
          p(`<strong>${escapeHtml(who)}</strong> just opened your deck <strong>${escapeHtml(deckName)}</strong>.`) +
          (viewerEmail && recipientLabel ? p(`<span style="color:${colors.textSecondary}">Viewer: ${escapeHtml(viewerEmail)}</span>`) : '') +
          p('Open it to see how far they got and where they spent time.'),
        cta: { label: 'See engagement', href: url },
        bodyText: `${who} just opened your deck "${deckName}". See engagement: ${url}`,
      };
    },
  } satisfies EmailTemplate<SlidesDeckOpenedData>,

  scheduled_report: {
    category: 'product',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'Scheduled delivery jobs (served via sendArtifactEmail, not this builder).',
  } satisfies EmailTemplate,

  first_publish: {
    category: 'product',
    audiences: ['ANY'],
    trigger: "publish.ts — a user's first-ever successful publish.",
    build: ({ pageName, url }: FirstPublishData) => ({
      subject: 'Your page is live',
      preheader: `${pageName} is live — share the link with anyone.`,
      heading: 'Your page is live',
      bodyHtml:
        p(`Your page <strong>${escapeHtml(pageName)}</strong> is live. Here's the link — share it, or open the page to keep building.`) +
        `<p style="margin:0 0 4px"><a href="${escapeHtml(url)}" style="color:${colors.primary};text-decoration:none;font-family:${fonts.mono};font-size:13px">${escapeHtml(url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></p>`,
      cta: { label: 'View your page', href: url },
      bodyText: `Your page "${pageName}" is live. Share the link, or open the page to keep building: ${url}`,
    }),
  } satisfies EmailTemplate<FirstPublishData>,

  first_view: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'lifecycle cron (daily sweep) — a recently-created page gets its first view.',
    build: ({ pageName, url }: FirstViewData) => ({
      subject: `Someone viewed ${pageName}`,
      preheader: `Your page ${pageName} got its first view.`,
      heading: 'Your page got its first view',
      bodyHtml: p(`<strong>${escapeHtml(pageName)}</strong> just got its first view — people are starting to find it.`),
      cta: { label: 'See your page', href: url },
      bodyText: `${pageName} just got its first view — people are starting to find it: ${url}`,
    }),
  } satisfies EmailTemplate<FirstViewData>,

  activation_nudge: {
    category: 'product',
    audiences: ['INDIVIDUAL'],
    trigger: 'lifecycle cron (hourly) — signed up ~48h ago, still no publish.',
    build: (_d: Record<string, unknown>, { baseUrl }) => ({
      subject: 'Ready to publish your first page?',
      preheader: 'Turn an idea into a live page in one click.',
      heading: 'Ready to publish your first page?',
      bodyHtml:
        p("You signed up but haven't published yet. ShareOut turns an idea into a live page with real data — no servers, no setup.") +
        p('Open the <strong>Start Here</strong> example on your home; it walks you through publishing your own in a couple of minutes.'),
      cta: { label: 'Open your home', href: `${baseUrl}/app` },
      bodyText: "You signed up but haven't published yet. Open the Start Here example on your home — it walks you through publishing your first page.",
    }),
  } satisfies EmailTemplate,

  member_joined: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'workspaces/invite.ts — an already-active member is added to a workspace (any tier). Pending invites notify the inviter via invite_accepted at claim time instead.',
    build: ({ memberName, workspaceName }: MemberJoinedData, { baseUrl }) => {
      const body = `<strong>${escapeHtml(memberName)}</strong> is now a member of your <strong>${escapeHtml(workspaceName)}</strong> workspace. They can build and publish pages there.`;
      return {
        subject: `${memberName} joined ${workspaceName}`,
        preheader: `${memberName} is now a member of ${workspaceName}.`,
        heading: `${memberName} joined ${workspaceName}`,
        bodyHtml: p(body),
        cta: { label: 'Open workspace', href: `${baseUrl}/home` },
        bodyText: `${memberName} is now a member of your ${workspaceName} workspace.`,
      };
    },
  } satisfies EmailTemplate<MemberJoinedData>,

  data_source_broke: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'TODO(P3): a live page\'s data source goes stale (spike-gated).',
  } satisfies EmailTemplate,

  // ===== commercial =====







  // ===== marketing =====
  weekly_digest: {
    category: 'marketing',
    audiences: ['ANY'],
    trigger: 'lifecycle cron (weekly, Mon) — opt-in; only when there is activity.',
    build: ({ views, comments, published }: WeeklyDigestData, { baseUrl }) => {
      const stat = (n: number, label: string) => `<strong>${n}</strong> ${label}${n === 1 ? '' : 's'}`;
      const parts = [
        views > 0 ? stat(views, 'view') : '',
        comments > 0 ? stat(comments, 'new comment') : '',
        published > 0 ? stat(published, 'page published') : '',
      ].filter(Boolean);
      return {
        subject: 'Your ShareOut week',
        preheader: `${views} views and ${comments} comments this week.`,
        heading: 'Your week on ShareOut',
        bodyHtml: p(`Here's what happened across your pages this week: ${parts.join(', ')}.`),
        cta: { label: 'Open your home', href: `${baseUrl}/app` },
        bodyText: `Your week on ShareOut: ${parts.join(', ')}.`,
      };
    },
  } satisfies EmailTemplate<WeeklyDigestData>,

  // Per-workspace retention digest — reaches members by default (product), opt-out
  // via the product category. Distinct from weekly_digest (per-owner, marketing).
  workspace_weekly_digest: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'lifecycle cron (weekly, Mon 13:00 UTC) — one per active workspace, to its internal members.',
    build: (d: WorkspaceDigestData) => {
      const link = (href: string, label: string) =>
        `<a href="${escapeHtml(href)}" style="color:${colors.primary};text-decoration:none">${escapeHtml(label)}</a>`;
      const li = (inner: string) => `<li style="margin:0 0 6px">${inner}</li>`;
      const section = (title: string, items: string) =>
        items
          ? `<p style="margin:18px 0 6px;font-weight:600;color:${colors.text}">${title}</p><ul style="margin:0 0 8px;padding-left:18px">${items}</ul>`
          : '';

      const published = section(
        'Published & updated',
        d.updated.map((a) => li(link(a.url, a.name) + (a.description ? ` — ${escapeHtml(a.description)}` : ''))).join(''),
      );
      const viewed = section(
        'Most viewed',
        d.topViewed.map((a) => li(`${link(a.url, a.name)} · ${a.views} view${a.views === 1 ? '' : 's'}`)).join(''),
      );
      const stale = section(
        'Needs a refresh',
        d.staleData.map((a) => li(link(a.url, a.name) + ' — data looks stale')).join(''),
      );
      const comments =
        d.openComments > 0
          ? p(`<strong>${d.openComments}</strong> open comment${d.openComments === 1 ? '' : 's'} waiting on a reply.`)
          : '';
      const intro = d.narrative
        ? p(escapeHtml(d.narrative))
        : p(`Here's what happened in <strong>${escapeHtml(d.workspaceName)}</strong> last week.`);

      return {
        subject: `Your week in ${d.workspaceName}`,
        preheader: 'What happened in your workspace last week.',
        heading: `Your week in ${d.workspaceName}`,
        bodyHtml: intro + published + viewed + comments + stale,
        cta: { label: 'Open your workspace', href: d.homeUrl },
        footerNote: `You're receiving this because you're a member of ${d.workspaceName}.`,
      };
    },
  } satisfies EmailTemplate<WorkspaceDigestData>,

  // win_back is 'product' (not 'marketing') so it sends by default with an
  // unsubscribe link — marketing defaults to opt-in, which would mute it entirely.
  win_back: {
    category: 'product',
    audiences: ['ANY'],
    trigger: 'lifecycle cron (daily) — last active ~14d / ~30d ago.',
    build: (_d: Record<string, unknown>, { baseUrl }) => ({
      subject: 'Your pages are still live on ShareOut',
      preheader: 'Pick up where you left off.',
      heading: 'Your pages are still live',
      bodyHtml:
        p("It's been a while. Your ShareOut pages are still live and ready whenever you want to update or share them.") +
        p('Come build something new — it still takes one click.'),
      cta: { label: 'Open ShareOut', href: `${baseUrl}/home` },
      bodyText: 'Your ShareOut pages are still live and ready. Come build something new — it still takes one click.',
    }),
  } satisfies EmailTemplate,
} satisfies Record<string, EmailTemplate<any>>;

export type EmailType = keyof typeof EMAILS;
