import type { Env } from '../types';
import { sendEmail } from '../scheduling/email';
import { isCategoryAllowed } from './preferences';
import { isSuppressed } from './suppressions';
import { resolveAudience } from './audience';
import { unsubscribeUrl } from './unsubscribe-token';
import { renderEmailLayout, renderEmailText } from './layout';
import { EMAILS, type EmailType, type EmailTemplate } from './catalog';
import { getPlatformHostname, getPlatformOrigin } from '../config/origins';

// The single chokepoint every lifecycle email flows through. Given a type + data,
// it looks up the catalog template, enforces audience segmentation + per-category
// opt-out + the suppression list, renders the shared layout, attaches the
// List-Unsubscribe header, and sends. No scattered call can leak a commercial email
// to a team member or mail a bounced/unsubscribed address.
//
// Jobs + CrewAI email_send bypass this gateway (sendArtifactEmail) and stay live
// when LIFECYCLE_EMAILS_DISABLED is on.

export type { EmailType };
export { EMAILS };

export interface DispatchInput<D = Record<string, unknown>> {
  type: EmailType;
  /** Preferred: a known user. Resolves email, audience, prefs, unsubscribe link. */
  toUserId?: string;
  /** For external (non-user) recipients, or when the userId is unknown. */
  toEmail?: string;
  /** Typed data the catalog template needs to build subject + copy. */
  data?: D;
  replyTo?: string;
  from?: string;
}

export type SkipReason =
  | 'no_recipient'
  | 'audience'
  | 'opted_out'
  | 'suppressed'
  | 'no_template'
  | 'disabled';

export interface DispatchResult {
  sent: boolean;
  skipped?: SkipReason;
  messageId?: string;
  error?: string;
}

/** When LIFECYCLE_EMAILS_DISABLED is on, every catalog email is skipped.
 *  Jobs + CrewAI use sendArtifactEmail and are unaffected. */
function lifecycleEmailsDisabled(env: Env): boolean {
  const v = (env.LIFECYCLE_EMAILS_DISABLED || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function defaultFrom(env: Env): string {
  return env.EMAIL_DEFAULT_FROM || `noreply@${getPlatformHostname(env)}`;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function emailForUser(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string | null }>();
  return row?.email ? row.email.toLowerCase().trim() : null;
}

export async function dispatchLifecycleEmail(env: Env, input: DispatchInput): Promise<DispatchResult> {
  // ponytail: hard pause — catalog sends only; jobs/crew use sendArtifactEmail
  if (lifecycleEmailsDisabled(env)) {
    return { sent: false, skipped: 'disabled' };
  }
  const tmpl: EmailTemplate<any> = EMAILS[input.type];

  const userId = input.toUserId ?? null;
  const email = (input.toEmail ?? (userId ? await emailForUser(env, userId) : null))?.toLowerCase().trim() || null;
  if (!email) return { sent: false, skipped: 'no_recipient' };

  const allowsAny = tmpl.audiences.includes('ANY');

  // Audience gate.
  if (userId) {
    if (!allowsAny) {
      const { segment } = await resolveAudience(env, userId);
      if (!tmpl.audiences.includes(segment)) return { sent: false, skipped: 'audience' };
    }
  } else if (!allowsAny && !tmpl.audiences.includes('EXTERNAL')) {
    // No user id: can't resolve a segment, so only ANY (unrestricted) or EXTERNAL
    // types may go to a bare address. Segmented types (commercial, etc.) are blocked.
    return { sent: false, skipped: 'audience' };
  }

  // Preference (skips transactional; only meaningful for known users).
  if (userId && tmpl.category !== 'transactional') {
    if (!(await isCategoryAllowed(env, userId, tmpl.category))) return { sent: false, skipped: 'opted_out' };
  }

  // Suppression — always, including external recipients.
  if (await isSuppressed(env, email)) return { sent: false, skipped: 'suppressed' };

  if (!tmpl.build) return { sent: false, skipped: 'no_template', error: `No builder for email type "${input.type}"` };

  const baseUrl = getPlatformOrigin(env);
  const built = tmpl.build(input.data ?? {}, { env, baseUrl });

  const managePreferencesUrl = tmpl.category !== 'transactional' ? `${baseUrl}/v1/email/center` : undefined;
  const html = renderEmailLayout({
    baseUrl,
    preheader: built.preheader,
    heading: built.heading,
    bodyHtml: built.bodyHtml,
    cta: built.cta,
    footerNote: built.footerNote,
    managePreferencesUrl,
  });
  const text =
    built.text ??
    renderEmailText({
      heading: built.heading,
      bodyText: built.bodyText ?? stripTags(built.bodyHtml),
      cta: built.cta,
      footerNote: built.footerNote,
    });

  const headers: Record<string, string> = {};
  if (userId && tmpl.category !== 'transactional') {
    const url = await unsubscribeUrl(env, userId, tmpl.category);
    headers['List-Unsubscribe'] = `<${url}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const res = await sendEmail(env, {
    from: input.from || defaultFrom(env),
    to: [email],
    subject: built.subject,
    html,
    text,
    replyTo: input.replyTo,
    headers: Object.keys(headers).length ? headers : undefined,
  });
  return { sent: res.success, messageId: res.messageId, error: res.error };
}
