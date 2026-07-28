// The one shared email shell. Every lifecycle email renders through this so the
// whole product speaks with one branded, Outlook-safe voice. Built to the design
// system: warm neutrals (never cold grays), blue used ONLY for the single primary
// action + the logo mark (the 80/15/5 neutral/white/blue ratio), generous spacing,
// 16px card radius, warm-tinted shadow, one clear action per email. Table-based
// because divs with max-width don't center in Outlook.
import { colors, fonts, radius, shadows } from '../design-system/tokens';
import { BRAND } from '../brand';

/** Centralized HTML escaper — replaces the per-file copies in share-email.ts,
 *  workspaces-invite-email.ts, comment-notify.ts, and data/email/handler.ts. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

export interface EmailCta {
  label: string;
  href: string;
}

export interface EmailLayoutInput {
  /** Hidden inbox-preview snippet shown after the subject in most clients. */
  preheader?: string;
  /** Main heading (plain text — escaped here). */
  heading: string;
  /** Inner content. MUST be already safe/escaped by the caller. */
  bodyHtml: string;
  /** The ONE primary action. Keep it to a single button per email. */
  cta?: EmailCta;
  /** Small print under the divider, e.g. why they're receiving this. */
  footerNote?: string;
  /** When set, a "Manage email preferences" link appears in the footer. */
  managePreferencesUrl?: string;
  /** Absolute base URL for the logo asset (defaults to production). */
  baseUrl?: string;
}

const DEFAULT_BASE = 'https://shareout.site';

function logoUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}${BRAND.logoMark}`;
}

/** Full <!DOCTYPE> HTML email document. */
export function renderEmailLayout(input: EmailLayoutInput): string {
  const { preheader, heading, bodyHtml, cta, footerNote, managePreferencesUrl } = input;
  const baseUrl = input.baseUrl || DEFAULT_BASE;

  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;height:0;width:0;font-size:1px;line-height:1px">${escapeHtml(preheader)}</div>`
    : '';

  // The single primary action. Blue is reserved for exactly this (and the mark).
  const ctaHtml = cta
    ? `<tr><td style="padding:8px 32px 4px">
          <a href="${escapeHtml(cta.href)}" style="display:inline-block;background:${colors.primary};color:${colors.textInverse};text-decoration:none;font-family:${fonts.body};font-weight:600;font-size:16px;line-height:1;padding:15px 28px;border-radius:${radius.sm}">${escapeHtml(cta.label)}</a>
        </td></tr>`
    : '';

  const manageLink = managePreferencesUrl
    ? ` · <a href="${escapeHtml(managePreferencesUrl)}" style="color:${colors.textTertiary};text-decoration:underline">Manage email preferences</a>`
    : '';

  const footerNoteHtml = footerNote
    ? `<p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:${colors.textTertiary}">${escapeHtml(footerNote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:${colors.bg};font-family:${fonts.body};color:${colors.text};-webkit-font-smoothing:antialiased">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${colors.bg};padding:40px 16px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${colors.bgElevated};border:1px solid ${colors.border};border-radius:${radius.md};overflow:hidden;box-shadow:${shadows.sm}">
        <!-- header: blue mark + wordmark, hairline divider (echoes the product toolbar) -->
        <tr><td style="padding:24px 32px;border-bottom:1px solid ${colors.border}">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:9px;vertical-align:middle"><img src="${logoUrl(baseUrl)}" width="24" height="24" alt="" style="display:block;border:0;border-radius:6px"></td>
            <td style="vertical-align:middle;font-family:${fonts.display};font-weight:700;font-size:17px;letter-spacing:-.01em;color:${colors.text}">ShareOut</td>
          </tr></table>
        </td></tr>
        <!-- heading -->
        <tr><td style="padding:32px 32px 0">
          <h1 style="margin:0;font-family:${fonts.display};font-weight:700;font-size:24px;line-height:1.25;letter-spacing:-.01em;color:${colors.text}">${escapeHtml(heading)}</h1>
        </td></tr>
        <!-- body -->
        <tr><td style="padding:14px 32px 4px;font-family:${fonts.body};font-size:15px;line-height:1.65;color:${colors.textSecondary}">${bodyHtml}</td></tr>
        ${ctaHtml}
        <!-- footer -->
        <tr><td style="padding:28px 32px 28px">
          <div style="border-top:1px solid ${colors.border};padding-top:18px">
            <p style="margin:0;font-size:12px;line-height:1.5;color:${colors.textTertiary}">Sent by ShareOut${manageLink}</p>
            ${footerNoteHtml}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export interface EmailTextInput {
  heading: string;
  /** Plain-text body (no markup). */
  bodyText: string;
  cta?: EmailCta;
  footerNote?: string;
}

/** Plaintext twin of renderEmailLayout. */
export function renderEmailText(input: EmailTextInput): string {
  const parts = [input.heading, '', input.bodyText.trim()];
  if (input.cta) parts.push('', `${input.cta.label}: ${input.cta.href}`);
  parts.push('', '— ShareOut');
  if (input.footerNote) parts.push('', input.footerNote);
  return parts.join('\n');
}
