import type { Env } from '../types';
import {
  getTemplateForArtifact,
  renderTemplate,
  buildTemplateContext,
  applyDefaults,
} from './templates';
import { captureArtifactReport } from '../screenshots';
import { generateId } from '../crypto-utils';
import { suppressedSet } from '../email/suppressions';
import { getPlatformHostname } from '../config/origins';

// Attachments use the Workers binding's ambient `EmailAttachment` type
// (workers-types). We only ever produce `disposition: 'attachment'` (CSV as a raw
// string, PDF as an ArrayBuffer).

export interface EmailConfig {
  recipients: string[];
  subject?: string;
  body?: string;
  html?: string;
  /** Overrides artifact default reply_to (e.g. visitor email on contact forms) */
  replyTo?: string;
  includeArtifactLink?: boolean;
  includeArtifactContent?: boolean;
  /** Reference to an email template */
  template_id?: string;
  /** Data for template variable interpolation */
  template_data?: Record<string, unknown>;
  /** Server-render the live artifact to PDF and attach it (re-runs data via the workspace connection). */
  renderPdf?: boolean;
  /** Attach the artifact's window.__shareoutExport.csv (re-rendered). */
  attachArtifactCsv?: boolean;
  /** Use the artifact's window.__shareoutExport.emailHtml/Subject as the email body. */
  useArtifactEmailHtml?: boolean;
  /** Filename for the rendered PDF attachment (default: <slug>.pdf). */
  pdfFilename?: string;
}

export interface SendEmailParams {
  from: string;
  replyTo?: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  /** Extra MIME headers, e.g. List-Unsubscribe (set by the email gateway). */
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

export function artifactEmailDomain(env: Env): string {
  if (env.EMAIL_ARTIFACTS_DOMAIN) return env.EMAIL_ARTIFACTS_DOMAIN;
  const host = getPlatformHostname(env);
  return !host || host === 'localhost' ? 'artifacts.shareout.site' : `artifacts.${host}`;
}

export function artifactEmailAddress(prefix: string, env: Env): string {
  return `${prefix}@${artifactEmailDomain(env)}`;
}

/** Domain inbound artifact inboxes receive on. Deliberately a dedicated subdomain
 *  so the inbound catch-all never collides with human mailboxes on the apex. */
export function inboxEmailDomain(env: Env): string {
  if (env.EMAIL_INBOX_DOMAIN) return env.EMAIL_INBOX_DOMAIN;
  const host = getPlatformHostname(env);
  return !host || host === 'localhost' ? 'inbox.shareout.site' : `inbox.${host}`;
}

export function inboxAddress(prefix: string, env: Env): string {
  return `${prefix}@${inboxEmailDomain(env)}`;
}

/** Generate a unique artifact_emails.email_prefix from an artifact slug, resolving
 *  collisions against existing rows. Shared by outbound (createArtifactEmail) and
 *  inbound (enableInbound) provisioning so a single artifact reuses one prefix. */
export async function generateEmailPrefix(env: Env, slug: string | null): Promise<string> {
  const base = (slug || 'report').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt}`;
    const exists = await env.DB.prepare(
      'SELECT 1 FROM artifact_emails WHERE email_prefix = ?'
    ).bind(candidate).first();
    if (!exists) return candidate;
  }
  return `${base}-${generateId('e').slice(2, 10)}`;
}

function defaultFromEmail(env: Env): string {
  if (env.EMAIL_DEFAULT_FROM) return env.EMAIL_DEFAULT_FROM;
  const host = getPlatformHostname(env);
  return !host || host === 'localhost' ? 'noreply@shareout.site' : `noreply@${host}`;
}

export async function sendEmail(env: Env, params: SendEmailParams): Promise<SendEmailResult> {
  const { from, replyTo, to, subject, text, html, attachments, headers } = params;

  if (!text && !html) {
    return { success: false, error: 'Email must have text or html content' };
  }

  if (!to.length) {
    return { success: false, error: 'At least one recipient is required' };
  }

  if (!env.EMAIL) {
    return {
      success: false,
      error: 'Email sending is not configured (missing EMAIL Workers binding)',
    };
  }

  // Defense in depth: drop suppressed addresses even on direct (non-gateway) sends
  // such as contact-form replies and scheduled deliveries. Fail-open — a suppression
  // lookup error must never block a legitimate send.
  let recipients = to;
  if (env.DB) {
    try {
      const suppressed = await suppressedSet(env, to);
      const kept = to.filter((addr) => !suppressed.has(addr.toLowerCase().trim()));
      if (!kept.length) return { success: false, error: 'All recipients are suppressed' };
      recipients = kept;
    } catch {
      recipients = to;
    }
  }

  try {
    const result = await env.EMAIL.send({
      from: { email: from, name: 'ShareOut' },
      to: recipients.length === 1 ? recipients[0] : recipients,
      subject,
      replyTo,
      text,
      html,
      ...(headers && Object.keys(headers).length ? { headers } : {}),
      ...(attachments && attachments.length ? { attachments } : {}),
    });

    return { success: true, messageId: result.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Cloudflare Email Service error: ${message}` };
  }
}

export async function sendArtifactEmail(
  env: Env,
  artifactId: string,
  config: EmailConfig
): Promise<SendEmailResult> {
  const artifact = await env.DB.prepare(
    `SELECT a.id, a.name, d.slug AS slug FROM artifacts a
     JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
     WHERE a.id = ?`
  ).bind(artifactId).first<{ id: string; name: string; slug: string }>();

  if (!artifact) {
    return { success: false, error: 'Artifact not found' };
  }

  const emailRecord = await env.DB.prepare(
    'SELECT email_prefix, reply_to FROM artifact_emails WHERE artifact_id = ?'
  ).bind(artifactId).first<{ email_prefix: string; reply_to: string | null }>();

  const artifactsDomain = artifactEmailDomain(env);
  const fromEmail = emailRecord
    ? `${emailRecord.email_prefix}@${artifactsDomain}`
    : defaultFromEmail(env);

  const artifactUrl = `${env.SHAREOUT_BASE_URL}/a/${artifact.slug || artifactId}/`;

  let htmlContent = '';
  let textContent = '';
  let subjectContent = config.subject || '';

  if (config.template_id) {
    const template = await getTemplateForArtifact(env, config.template_id, artifactId);
    if (!template) {
      return { success: false, error: `Template not found: ${config.template_id}` };
    }

    const context = buildTemplateContext({
      id: artifact.id,
      name: artifact.name,
      slug: artifact.slug || artifact.id,
      url: artifactUrl,
    });

    const data = applyDefaults(template.variables_schema, config.template_data || {});
    const rendered = renderTemplate(template.html, template.subject, context, data);

    htmlContent = rendered.html;
    subjectContent = rendered.subject;
    if (template.text_body) {
      const textRendered = renderTemplate(template.text_body, '', context, data);
      textContent = textRendered.html;
    }
  } else {
    htmlContent = config.html || '';
    textContent = config.body || '';
  }

  // Server-rendered delivery: re-run the live artifact (with injected owner creds,
  // so its data queries the workspace connection) once, and reuse the result for
  // the email body, a PDF attachment, and a CSV attachment.
  const attachments: EmailAttachment[] = [];
  if (config.renderPdf || config.attachArtifactCsv || config.useArtifactEmailHtml) {
    const captured = await captureArtifactReport(env, artifactId);
    if (config.useArtifactEmailHtml && captured.data?.emailHtml) {
      htmlContent = captured.data.emailHtml;
      if (captured.data.emailSubject) subjectContent = captured.data.emailSubject;
    }
    if (config.attachArtifactCsv && captured.data?.csv) {
      attachments.push({
        content: captured.data.csv,
        filename: captured.data.csvFilename || `${artifact.slug || 'report'}.csv`,
        type: 'text/csv',
        disposition: 'attachment',
      });
    }
    if (config.renderPdf && captured.pdf) {
      attachments.push({
        content: captured.pdf,
        filename: config.pdfFilename || `${artifact.slug || 'report'}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment',
      });
    }
  }

  if (config.includeArtifactLink) {
    const linkHtml = `<p><a href="${artifactUrl}">View ${artifact.name}</a></p>`;
    const linkText = `\n\nView artifact: ${artifactUrl}`;
    htmlContent = htmlContent ? `${htmlContent}${linkHtml}` : linkHtml;
    textContent = textContent ? `${textContent}${linkText}` : `View artifact: ${artifactUrl}`;
  }

  if (config.includeArtifactContent) {
    const entrypoint = await env.DB.prepare(`
      SELECT a.r2_key FROM assets a
      JOIN versions v ON a.version_id = v.id
      JOIN deployments d ON d.version_id = v.id
      WHERE d.artifact_id = ? AND a.path = v.entrypoint
    `).bind(artifactId).first<{ r2_key: string }>();

    if (entrypoint) {
      const content = await env.ARTIFACTS.get(entrypoint.r2_key);
      if (content) {
        const htmlBody = await content.text();
        htmlContent = htmlContent ? `${htmlContent}<hr/>${htmlBody}` : htmlBody;
      }
    }
  }

  if (!htmlContent && !textContent) {
    textContent = `Scheduled email from ${artifact.name}\n\n${artifactUrl}`;
    htmlContent = `<p>Scheduled email from <strong>${artifact.name}</strong></p><p><a href="${artifactUrl}">View Artifact</a></p>`;
  }

  return sendEmail(env, {
    from: fromEmail,
    replyTo: config.replyTo || emailRecord?.reply_to || undefined,
    to: config.recipients,
    subject: subjectContent || `Update from ${artifact.name}`,
    text: textContent || undefined,
    html: htmlContent || undefined,
    attachments: attachments.length ? attachments : undefined,
  });
}

export async function checkEmailRateLimit(
  env: Env,
  userId: string,
  artifactId: string
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const today = new Date().toISOString().split('T')[0];

  const userLimit = await env.DB.prepare(
    "SELECT count FROM rate_limits WHERE principal_type = 'user' AND principal_id = ? AND action = ? AND window_start = ?"
  ).bind(userId, 'schedule:email', today).first<{ count: number }>();

  const artifactEmails = await env.DB.prepare(
    'SELECT emails_sent_today, last_reset_date FROM artifact_emails WHERE artifact_id = ?'
  ).bind(artifactId).first<{ emails_sent_today: number; last_reset_date: string }>();

  const userCount = userLimit?.count || 0;
  const artifactCount = artifactEmails?.last_reset_date === today ? (artifactEmails?.emails_sent_today || 0) : 0;

  const USER_DAILY_LIMIT = 50;
  const ARTIFACT_DAILY_LIMIT = 10;

  const userRemaining = Math.max(0, USER_DAILY_LIMIT - userCount);
  const artifactRemaining = Math.max(0, ARTIFACT_DAILY_LIMIT - artifactCount);
  const remaining = Math.min(userRemaining, artifactRemaining);

  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);

  return {
    allowed: remaining > 0,
    remaining,
    resetAt: Math.floor(tomorrow.getTime() / 1000),
  };
}

export async function incrementEmailCount(env: Env, userId: string, artifactId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  await env.DB.prepare(`
    INSERT INTO rate_limits (principal_type, principal_id, action, window_start, count)
    VALUES ('user', ?, 'schedule:email', ?, 1)
    ON CONFLICT (principal_type, principal_id, action, window_start) DO UPDATE SET count = count + 1
  `).bind(userId, today).run();

  await env.DB.prepare(`
    UPDATE artifact_emails
    SET emails_sent_today = CASE WHEN last_reset_date = ? THEN emails_sent_today + 1 ELSE 1 END,
        last_reset_date = ?
    WHERE artifact_id = ?
  `).bind(today, today, artifactId).run();
}
