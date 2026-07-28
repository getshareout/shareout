// Web invite accept — the human counterpart to the agent claim API. A person who
// got a workspace/Sharee invite clicks the "Join" button in their email and lands
// here. The membership edge already exists (written at invite time), so accepting is
// just: verify the signed-in session owns this invite, mark the code consumed, and
// drop them into the workspace (or /shared for externals). No code typing, no skill
// install — that path stays for agents.
import type { Env } from '../types';
import { renderHtmlPage } from '../design-system/shell';
import { escapeHtml } from '../html/utils';
import {
  resolveClaim,
  markClaimClaimed,
  notifyInviteAccepted,
  peekInvite,
  inviteLandingUrl,
} from '../workspaces-invite-email';

type SessionUser = { id: string; email: string };

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const shown = local.slice(0, 1);
  return `${shown}${'•'.repeat(Math.max(2, local.length - 1))}@${domain}`;
}

const STYLES = `
  .iv-wrap { min-height: 70vh; display: flex; align-items: center; justify-content: center; padding: var(--space-8) var(--space-6); }
  .iv-card { max-width: 420px; width: 100%; text-align: center; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-10) var(--space-8); box-shadow: var(--shadow-sm); }
  .iv-title { font-size: 22px; font-weight: 700; color: var(--color-text); margin: 0 0 var(--space-3); }
  .iv-body { color: var(--color-text-secondary); font-size: 15px; line-height: 1.6; margin: 0 0 var(--space-6); }
  .iv-btn { display: inline-block; min-height: 48px; padding: 14px 28px; border-radius: var(--radius-md); background: var(--color-primary); color: var(--color-text-inverse); font-weight: 600; font-size: 16px; text-decoration: none; transition: transform .1s, background .15s; }
  .iv-btn:hover { background: var(--color-primary-hover); transform: translateY(-1px); }
  .iv-btn:active { transform: translateY(0) scale(.98); }
  .iv-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
`;

function card(title: string, body: string, cta?: { label: string; href: string }): Response {
  const btn = cta
    ? `<a class="iv-btn" href="${escapeHtml(cta.href)}">${escapeHtml(cta.label)}</a>`
    : '';
  return renderHtmlPage({
    title: `${title} · ShareOut`,
    description: 'ShareOut invite',
    pageStyles: STYLES,
    body: `<div class="iv-wrap"><div class="iv-card">
      <h1 class="iv-title">${escapeHtml(title)}</h1>
      <p class="iv-body">${body}</p>
      ${btn}
    </div></div>`,
    cacheControl: 'no-store',
    status: 200,
  });
}

/** Unauth GET /invite/<code> — branded join card, then Continue with Google. */
export async function handleInviteJoinPage(
  request: Request,
  env: Env,
  code: string
): Promise<Response> {
  const invitePath = `/invite/${encodeURIComponent(code)}`;
  const googleHref = `/auth/login?redirect=${encodeURIComponent(invitePath)}`;
  const peek = await peekInvite(env, code);

  if (!peek) {
    return card(
      "We couldn't find that invite",
      'The link may be broken, already used, or expired. Ask whoever invited you to send a new one.'
    );
  }

  return card(
    `Join ${peek.workspaceName}`,
    `${escapeHtml(peek.inviterName)} invited you to <strong>${escapeHtml(peek.workspaceName)}</strong> on ShareOut. Sign in and you're in.`,
    { label: 'Continue with Google', href: googleHref }
  );
}

// GET /invite/<code> — authenticated path (router calls this after session check).
export async function handleInviteAcceptPage(
  request: Request,
  env: Env,
  user: SessionUser,
  code: string
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const invitePath = `/invite/${encodeURIComponent(code)}`;
  const result = await resolveClaim(env, code, user);

  if (result.ok) {
    await markClaimClaimed(env, result.claim.id);
    await notifyInviteAccepted(env, result.claim).catch(() => {});
    const dest = await inviteLandingUrl(env, origin, result.claim);
    return Response.redirect(dest, 302);
  }

  switch (result.reason) {
    case 'CODE_MISMATCH':
      return card(
        'This invite was for a different email',
        `It was sent to <strong>${escapeHtml(maskEmail(result.invitedEmail || ''))}</strong>. Sign in with that address to join, or ask whoever invited you for a new one.`,
        { label: 'Sign in with a different account', href: `/auth/logout?redirect=${encodeURIComponent(invitePath)}` }
      );
    case 'CODE_USED':
      return card(
        'This invite was already used',
        'Looks like it was already accepted. Open ShareOut to keep going.',
        { label: 'Open ShareOut', href: '/home' }
      );
    case 'CODE_EXPIRED':
      return card(
        'This invite has expired',
        'Invites last 7 days. Ask whoever invited you to send a new one.'
      );
    default:
      return card(
        "We couldn't find that invite",
        'The link may be broken or incomplete. Ask whoever invited you to send a new one.'
      );
  }
}
