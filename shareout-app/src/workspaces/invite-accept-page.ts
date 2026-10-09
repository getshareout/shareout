// Web invite accept — the human counterpart to the agent claim API. A person who
// got a workspace/Sharee invite clicks the "Join" button in their email and lands
// here. The membership edge already exists (written at invite time), so accepting is
// just: verify the signed-in session owns this invite, mark the code consumed, and
// drop them into the workspace (or /shared for externals). No code typing, no skill
// install — that path stays for agents.
import type { Env } from '../types';
import { renderHtmlPage } from '../design-system/shell';
import { escapeHtml } from '../html/utils';
import { pageLocale, type PageLocale } from '../i18n/accept-language';
import {
  resolveClaim,
  markClaimClaimed,
  notifyInviteAccepted,
  peekInvite,
  inviteLandingUrl,
} from '../workspaces-invite-email';

type SessionUser = { id: string; email: string };

// Page copy, en + rioplatense es. `{x}` slots are filled with already-escaped values.
const COPY: Record<PageLocale, Record<string, string>> = {
  en: {
    notFoundTitle: "We couldn't find that invite",
    notFoundBody: 'The link may be broken, already used, or expired. Ask whoever invited you to send a new one.',
    brokenBody: 'The link may be broken or incomplete. Ask whoever invited you to send a new one.',
    joinTitle: 'Join {ws}',
    joinBody: "{inviter} invited you to <strong>{ws}</strong> on ShareOut. Sign in and you're in.",
    invitedAs: 'You were invited as <strong>{email}</strong>.',
    continue: 'Continue',
    mismatchTitle: 'This invite is for a different email',
    mismatchBody: "You're signed in as <strong>{current}</strong>, but the invite was sent to <strong>{invited}</strong>. Sign out and sign in with that address to join — or ask whoever invited you for a new one.",
    mismatchCta: 'Sign in with the invited email',
    usedTitle: 'This invite was already used',
    usedBody: 'Looks like it was already accepted. Open ShareOut to keep going.',
    openCta: 'Open ShareOut',
    expiredTitle: 'This invite has expired',
    expiredBody: 'Invites last 7 days. Ask whoever invited you to send a new one.',
  },
  es: {
    notFoundTitle: 'No encontramos esa invitación',
    notFoundBody: 'Puede que el link esté roto, ya se haya usado o haya vencido. Pedile a quien te invitó que te mande otra.',
    brokenBody: 'Puede que el link esté roto o incompleto. Pedile a quien te invitó que te mande otra.',
    joinTitle: 'Sumate a {ws}',
    joinBody: '{inviter} te invitó a <strong>{ws}</strong> en ShareOut. Iniciá sesión y ya estás adentro.',
    invitedAs: 'Te invitaron como <strong>{email}</strong>.',
    continue: 'Continuar',
    mismatchTitle: 'Esta invitación es para otro email',
    mismatchBody: 'Entraste como <strong>{current}</strong>, pero la invitación se mandó a <strong>{invited}</strong>. Cerrá sesión y entrá con esa dirección para sumarte, o pedile a quien te invitó que te mande otra.',
    mismatchCta: 'Entrar con el email invitado',
    usedTitle: 'Esta invitación ya se usó',
    usedBody: 'Parece que ya la aceptaron. Abrí ShareOut para seguir.',
    openCta: 'Abrir ShareOut',
    expiredTitle: 'Esta invitación venció',
    expiredBody: 'Las invitaciones duran 7 días. Pedile a quien te invitó que te mande otra.',
  },
};
type Copy = Record<string, string>;

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? escapeHtml(vars[k]) : m));
}

/** An explicit `?lang=` survives the hop to sign-in so the whole flow stays in one language. */
function explicitLang(request: Request): string {
  const q = new URL(request.url).searchParams.get('lang');
  return q === 'en' || q === 'es' ? q : '';
}

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
  .iv-note { font-size: 14px; margin-top: calc(-1 * var(--space-3)); }
  .iv-btn { display: inline-block; min-height: 48px; padding: 14px 28px; border-radius: var(--radius-md); background: var(--color-primary); color: var(--color-text-inverse); font-weight: 600; font-size: 16px; text-decoration: none; transition: transform .1s, background .15s; }
  .iv-btn:hover { background: var(--color-primary-hover); transform: translateY(-1px); }
  .iv-btn:active { transform: translateY(0) scale(.98); }
  .iv-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
`;

function card(lang: PageLocale, title: string, body: string, cta?: { label: string; href: string }, note?: string): Response {
  const btn = cta
    ? `<a class="iv-btn" href="${escapeHtml(cta.href)}">${escapeHtml(cta.label)}</a>`
    : '';
  return renderHtmlPage({
    title: `${title} · ShareOut`,
    description: 'ShareOut invite',
    pageStyles: STYLES,
    lang,
    body: `<div class="iv-wrap"><div class="iv-card">
      <h1 class="iv-title">${escapeHtml(title)}</h1>
      <p class="iv-body">${body}</p>
      ${note ? `<p class="iv-body iv-note">${note}</p>` : ''}
      ${btn}
    </div></div>`,
    cacheControl: 'no-store',
    status: 200,
  });
}

/** Unauth GET /invite/<code> — branded join card, then sign-in with the invited email pre-filled. */
export async function handleInviteJoinPage(
  request: Request,
  env: Env,
  code: string
): Promise<Response> {
  const lang = pageLocale(request);
  const c: Copy = COPY[lang];
  const invitePath = `/invite/${encodeURIComponent(code)}`;
  const peek = await peekInvite(env, code);

  if (!peek) return card(lang, c.notFoundTitle, escapeHtml(c.notFoundBody));

  const forced = explicitLang(request);
  const signInHref = `/auth/login?redirect=${encodeURIComponent(invitePath)}&login_hint=${encodeURIComponent(peek.email)}${forced ? `&lang=${forced}` : ''}`;
  return card(
    lang, c.joinTitle.replace('{ws}', peek.workspaceName),
    fill(c.joinBody, { inviter: peek.inviterName, ws: peek.workspaceName }),
    { label: c.continue, href: signInHref },
    fill(c.invitedAs, { email: peek.email })
  );
}

// GET /invite/<code> — authenticated path (router calls this after session check).
export async function handleInviteAcceptPage(
  request: Request,
  env: Env,
  user: SessionUser,
  code: string
): Promise<Response> {
  const lang = pageLocale(request);
  const c: Copy = COPY[lang];
  const forced = explicitLang(request);
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
        lang, c.mismatchTitle,
        fill(c.mismatchBody, { current: user.email || '', invited: maskEmail(result.invitedEmail || '') }),
        { label: c.mismatchCta, href: `/auth/logout?redirect=${encodeURIComponent(invitePath + (forced ? `?lang=${forced}` : ''))}` }
      );
    case 'CODE_USED':
      return card(lang, c.usedTitle, escapeHtml(c.usedBody), { label: c.openCta, href: '/home' });
    case 'CODE_EXPIRED':
      return card(lang, c.expiredTitle, escapeHtml(c.expiredBody));
    default:
      return card(lang, c.notFoundTitle, escapeHtml(c.brokenBody));
  }
}
