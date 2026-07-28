import type { DataContext } from '../middleware';
import { errorResponse, successResponse } from '../middleware';
import { DATA_ERRORS } from '../../types';
import {
  sendArtifactEmail,
  checkEmailRateLimit,
  incrementEmailCount,
  type EmailConfig,
} from '../../scheduling/email';
import { getArtifactEmail } from '../../scheduling/jobs';
import { checkSlidingWindowRateLimit, getTrustedClientIp } from '../../rate-limit';

const MAX_SUBJECT_LEN = 200;
const MAX_BODY_LEN = 50_000;

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Read-only-default gate for email send (Workstream A): anonymous visitors of a
// public artifact cannot trigger email unless the owner opted in
// (allow_anon_email). When anon is allowed, apply a per-requester-IP limit using
// the unspoofable cf-connecting-ip (fail closed if absent), so the per-owner
// email rate limit downstream can't be exhausted by one anonymous attacker.
// Returns an error Response to send, or null to proceed.
async function guardEmailSend(request: Request, ctx: DataContext): Promise<Response | null> {
  if (ctx.isOwner === true) return null;

  // Only ANONYMOUS visitors of a PUBLIC artifact are gated. Authenticated viewers
  // (workspace members / collaborators) and private/workspace artifacts — which
  // only reach here after checkDataAuth authorized them — keep working.
  // isOwner is already false/undefined here (owner returned above), so an
  // anonymous viewer is simply one with no verified email.
  const isPublic = ctx.artifact.visibility === 'public';
  const isAnon = !ctx.viewer?.email;
  if (!isPublic || !isAnon) return null;

  if (ctx.artifact.allow_anon_email !== 1) {
    return errorResponse(
      {
        ...DATA_ERRORS.FORBIDDEN,
        message: 'Email sending is disabled for anonymous visitors of this artifact.',
        hint: 'The artifact owner can enable anonymous email (allow_anon_email) or sign in.',
      },
      ctx.origin
    );
  }

  const ip = getTrustedClientIp(request);
  if (!ip) {
    return errorResponse(
      { ...DATA_ERRORS.FORBIDDEN, message: 'Could not verify your network; email blocked.' },
      ctx.origin
    );
  }

  const rl = await checkSlidingWindowRateLimit(ctx.env.RATE_LIMIT_KV, `email:${ip}`, 'anonymous');
  if (!rl.allowed) {
    return errorResponse(
      {
        ...DATA_ERRORS.RATE_LIMITED,
        message: 'Too many email requests from your network. Try again later.',
        hint: `Resets at ${new Date(rl.reset * 1000).toISOString()}`,
      },
      ctx.origin
    );
  }
  return null;
}

export async function getArtifactOwner(
  ctx: DataContext
): Promise<{ ownerId: string; ownerEmail: string | null } | null> {
  const row = await ctx.env.DB.prepare(
    'SELECT a.owner_id, u.email FROM artifacts a LEFT JOIN users u ON u.id = a.owner_id WHERE a.id = ?'
  ).bind(ctx.artifactId).first<{ owner_id: string; email: string | null }>();

  if (!row) return null;
  return { ownerId: row.owner_id, ownerEmail: row.email };
}

export async function handleEmail(
  request: Request,
  ctx: DataContext,
  subPath: string
): Promise<Response> {
  const path = subPath.replace(/\/$/, '') || '/';

  if (path === '/status' && request.method === 'GET') {
    return handleStatus(ctx);
  }

  if (path === '/notify-owner' && request.method === 'POST') {
    return handleNotifyOwner(request, ctx);
  }

  if (path === '/send-report' && request.method === 'POST') {
    return handleSendReport(request, ctx);
  }

  return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
}

async function handleStatus(ctx: DataContext): Promise<Response> {
  const from = await getArtifactEmail(ctx.env, ctx.artifactId);
  const owner = await getArtifactOwner(ctx);

  return successResponse(
    {
      enabled: Boolean(ctx.env.EMAIL),
      from: from || undefined,
      ownerEmailConfigured: Boolean(owner?.ownerEmail),
    },
    200,
    ctx.origin
  );
}

async function handleNotifyOwner(request: Request, ctx: DataContext): Promise<Response> {
  if (!ctx.env.EMAIL) {
    return errorResponse(
      { ...DATA_ERRORS.CONFIG_ERROR, message: 'Email sending is not configured on this deployment' },
      ctx.origin
    );
  }

  const guard = await guardEmailSend(request, ctx);
  if (guard) return guard;

  const owner = await getArtifactOwner(ctx);
  if (!owner) {
    return errorResponse(DATA_ERRORS.ARTIFACT_NOT_FOUND, ctx.origin);
  }

  if (!owner.ownerEmail) {
    return errorResponse(
      {
        ...DATA_ERRORS.INVALID_REQUEST,
        message: 'Artifact owner has no email on file',
        hint: 'The owner must link an email via POST /v1/auth/link-email before contact forms can send mail.',
      },
      ctx.origin
    );
  }

  let body: {
    subject?: string;
    text?: string;
    html?: string;
    replyTo?: string;
    includeArtifactLink?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }

  const subject = (body.subject || `Message from ${ctx.artifact.name}`).trim();
  if (!subject || subject.length > MAX_SUBJECT_LEN) {
    return errorResponse(
      {
        ...DATA_ERRORS.INVALID_REQUEST,
        message: `subject is required and must be at most ${MAX_SUBJECT_LEN} characters`,
        param: 'subject',
      },
      ctx.origin
    );
  }

  const text = body.text?.trim();
  const html = body.html?.trim();
  if (!text && !html) {
    return errorResponse(
      {
        ...DATA_ERRORS.INVALID_REQUEST,
        message: 'text or html body is required',
        param: 'text',
      },
      ctx.origin
    );
  }

  if ((text && text.length > MAX_BODY_LEN) || (html && html.length > MAX_BODY_LEN)) {
    return errorResponse(
      {
        ...DATA_ERRORS.INVALID_REQUEST,
        message: `Body must be at most ${MAX_BODY_LEN} characters`,
      },
      ctx.origin
    );
  }

  if (body.replyTo && !isValidEmail(body.replyTo)) {
    return errorResponse(
      { ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid replyTo email', param: 'replyTo' },
      ctx.origin
    );
  }

  const rateLimit = await checkEmailRateLimit(ctx.env, owner.ownerId, ctx.artifactId);
  if (!rateLimit.allowed) {
    return errorResponse(
      {
        ...DATA_ERRORS.RATE_LIMITED,
        message: 'Email rate limit exceeded for this artifact',
        hint: `Resets at ${new Date(rateLimit.resetAt * 1000).toISOString()}`,
      },
      ctx.origin
    );
  }

  const config: EmailConfig = {
    recipients: [owner.ownerEmail],
    subject,
    body: text,
    html,
    replyTo: body.replyTo,
    includeArtifactLink: body.includeArtifactLink !== false,
  };

  const result = await sendArtifactEmail(ctx.env, ctx.artifactId, config);

  if (!result.success) {
    return errorResponse(
      {
        ...DATA_ERRORS.INTERNAL_ERROR,
        message: result.error || 'Failed to send email',
      },
      ctx.origin
    );
  }

  await incrementEmailCount(ctx.env, owner.ownerId, ctx.artifactId);

  return successResponse(
    { sent: true, messageId: result.messageId, to: owner.ownerEmail },
    200,
    ctx.origin
  );
}

async function handleSendReport(request: Request, ctx: DataContext): Promise<Response> {
  if (!ctx.env.EMAIL) {
    return errorResponse(
      { ...DATA_ERRORS.CONFIG_ERROR, message: 'Email sending is not configured on this deployment' },
      ctx.origin
    );
  }

  // send-report targets an ARBITRARY recipient — the open-relay/phishing vector.
  // Gate it behind the same anon-email opt-in + per-IP limit as notify-owner.
  const guard = await guardEmailSend(request, ctx);
  if (guard) return guard;

  const owner = await getArtifactOwner(ctx);
  if (!owner) {
    return errorResponse(DATA_ERRORS.ARTIFACT_NOT_FOUND, ctx.origin);
  }

  let body: {
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
    includeArtifactLink?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }

  const to = body.to?.trim().toLowerCase();
  if (!to || !isValidEmail(to)) {
    return errorResponse(
      { ...DATA_ERRORS.INVALID_REQUEST, message: 'Valid to email is required', param: 'to' },
      ctx.origin
    );
  }

  const subject = (body.subject || `${ctx.artifact.name} — reporte`).trim();
  if (!subject || subject.length > MAX_SUBJECT_LEN) {
    return errorResponse(
      {
        ...DATA_ERRORS.INVALID_REQUEST,
        message: `subject must be at most ${MAX_SUBJECT_LEN} characters`,
        param: 'subject',
      },
      ctx.origin
    );
  }

  const text = body.text?.trim();
  const html = body.html?.trim();
  if (!text && !html) {
    return errorResponse(
      {
        ...DATA_ERRORS.INVALID_REQUEST,
        message: 'text or html body is required',
        param: 'text',
      },
      ctx.origin
    );
  }

  if ((text && text.length > MAX_BODY_LEN) || (html && html.length > MAX_BODY_LEN)) {
    return errorResponse(
      {
        ...DATA_ERRORS.INVALID_REQUEST,
        message: `Body must be at most ${MAX_BODY_LEN} characters`,
      },
      ctx.origin
    );
  }

  const rateLimit = await checkEmailRateLimit(ctx.env, owner.ownerId, ctx.artifactId);
  if (!rateLimit.allowed) {
    return errorResponse(
      {
        ...DATA_ERRORS.RATE_LIMITED,
        message: 'Email rate limit exceeded for this artifact',
        hint: `Resets at ${new Date(rateLimit.resetAt * 1000).toISOString()}`,
      },
      ctx.origin
    );
  }

  const config: EmailConfig = {
    recipients: [to],
    subject,
    body: text,
    html,
    includeArtifactLink: body.includeArtifactLink !== false,
  };

  const result = await sendArtifactEmail(ctx.env, ctx.artifactId, config);

  if (!result.success) {
    return errorResponse(
      {
        ...DATA_ERRORS.INTERNAL_ERROR,
        message: result.error || 'Failed to send email',
      },
      ctx.origin
    );
  }

  await incrementEmailCount(ctx.env, owner.ownerId, ctx.artifactId);

  return successResponse(
    { sent: true, messageId: result.messageId, to },
    200,
    ctx.origin
  );
}
