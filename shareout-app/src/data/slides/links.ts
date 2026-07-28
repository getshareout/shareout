import { errorResponse, successResponse, verifyOwner, type DataContext } from '../middleware';
import { generateId, sha256 } from '../../crypto-utils';
import { dispatchLifecycleEmail } from '../../email/gateway';

// Slides B2B P1 — tracked & gated share links.
// Owner CRUD for links + a public access endpoint that validates the gate,
// enforces expiry/view-cap/revocation, and mints an *attributed* view session
// (viewer_email + link_id) the viewer then heartbeats against (0100 analytics).

type Gate = 'none' | 'email' | 'password' | 'domain';
const GATES: Gate[] = ['none', 'email', 'password', 'domain'];

interface ShareLinkRow {
  id: string;
  presentation_id: string;
  artifact_id: string;
  recipient_label: string | null;
  gate: string;
  gate_value: string | null;
  expires_at: string | null;
  max_views: number | null;
  created_at: string;
  revoked: number;
}

export async function handleLinksRoutes(
  request: Request,
  ctx: DataContext,
  presId: string,
  parts: string[]
): Promise<Response> {
  const lnkId = parts[0];

  if (!lnkId) {
    if (request.method === 'POST') return createLink(request, ctx, presId);
    if (request.method === 'GET') return listLinks(request, ctx, presId);
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  if (!lnkId.startsWith('lnk_')) {
    return errorResponse({ code: 'INVALID_ID', message: 'Invalid link ID', status: 400 });
  }

  const sub = parts[1];
  if (sub === 'access') {
    return accessLink(request, ctx, presId, lnkId);
  }
  if (!sub) {
    if (request.method === 'GET') return getLinkGate(ctx, presId, lnkId);   // public — gate metadata
    if (request.method === 'DELETE') return revokeLink(request, ctx, presId, lnkId);
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  return errorResponse({ code: 'NOT_FOUND', message: 'Link action not found', status: 404 });
}

async function hashPassword(pw: string): Promise<string> {
  return sha256(new TextEncoder().encode(`slides-link:${pw}`).buffer as ArrayBuffer);
}

// --- Owner CRUD ---------------------------------------------------------------

async function createLink(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  if (!(await verifyOwner(request, ctx))) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only the owner can create links', status: 403 });
  }

  let body: {
    recipientLabel?: string; gate?: Gate; password?: string; domains?: string[];
    expiresAt?: string; maxViews?: number;
  };
  try { body = await request.json(); } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  const gate: Gate = body.gate && GATES.includes(body.gate) ? body.gate : 'none';
  let gateValue: string | null = null;
  if (gate === 'password') {
    if (!body.password) return errorResponse({ code: 'PASSWORD_REQUIRED', message: 'password required for password gate', status: 400 });
    gateValue = await hashPassword(body.password);
  } else if (gate === 'domain') {
    const domains = (body.domains || []).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    if (domains.length === 0) return errorResponse({ code: 'DOMAINS_REQUIRED', message: 'domains required for domain gate', status: 400 });
    gateValue = domains.join(',');
  }

  const maxViews = Number.isInteger(body.maxViews) && (body.maxViews as number) > 0 ? body.maxViews! : null;
  const id = generateId('lnk');
  const now = new Date().toISOString();

  await ctx.env.DB.prepare(
    `INSERT INTO share_links (id, presentation_id, artifact_id, recipient_label, gate, gate_value, expires_at, max_views, created_by, created_at, revoked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).bind(id, presId, ctx.artifactId, body.recipientLabel ?? null, gate, gateValue, body.expiresAt ?? null, maxViews, ctx.artifact.owner_id ?? null, now).run();

  return successResponse({
    id,
    url: `${ctx.env.SHAREOUT_BASE_URL}/p/${ctx.artifact.name}?l=${id}`,
    recipientLabel: body.recipientLabel ?? null,
    gate, expiresAt: body.expiresAt ?? null, maxViews,
  }, 201, ctx.origin);
}

async function listLinks(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  if (!(await verifyOwner(request, ctx))) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only the owner can list links', status: 403 });
  }

  const rows = await ctx.env.DB.prepare(
    `SELECT l.*, (SELECT COUNT(*) FROM view_sessions v WHERE v.link_id = l.id) AS views
     FROM share_links l WHERE l.presentation_id = ? ORDER BY l.created_at DESC`
  ).bind(presId).all<ShareLinkRow & { views: number }>();

  const links = rows.results.map((l) => ({
    id: l.id,
    url: `${ctx.env.SHAREOUT_BASE_URL}/p/${ctx.artifact.name}?l=${l.id}`,
    recipientLabel: l.recipient_label,
    gate: l.gate,
    expiresAt: l.expires_at,
    maxViews: l.max_views,
    views: l.views,
    revoked: l.revoked === 1,
    createdAt: l.created_at,
  }));

  return successResponse({ links }, 200, ctx.origin);
}

async function revokeLink(request: Request, ctx: DataContext, presId: string, lnkId: string): Promise<Response> {
  if (!(await verifyOwner(request, ctx))) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only the owner can revoke links', status: 403 });
  }
  const res = await ctx.env.DB.prepare(
    `UPDATE share_links SET revoked = 1 WHERE id = ? AND presentation_id = ?`
  ).bind(lnkId, presId).run();
  if (!res.meta.changes) {
    return errorResponse({ code: 'LINK_NOT_FOUND', message: 'Link not found', status: 404 });
  }
  return successResponse({ revoked: true }, 200, ctx.origin);
}

// --- Public access ------------------------------------------------------------

async function loadLink(ctx: DataContext, presId: string, lnkId: string): Promise<ShareLinkRow | null> {
  return ctx.env.DB.prepare(
    `SELECT * FROM share_links WHERE id = ? AND presentation_id = ?`
  ).bind(lnkId, presId).first<ShareLinkRow>();
}

// Public — tells the viewer what the gate requires (no secrets leaked).
async function getLinkGate(ctx: DataContext, presId: string, lnkId: string): Promise<Response> {
  const link = await loadLink(ctx, presId, lnkId);
  if (!link) return errorResponse({ code: 'LINK_NOT_FOUND', message: 'Link not found', status: 404 });
  return successResponse({
    gate: link.gate,
    recipientLabel: link.recipient_label,
    revoked: link.revoked === 1,
    expired: !!link.expires_at && link.expires_at < new Date().toISOString(),
  }, 200, ctx.origin);
}

// Public — validate the gate, enforce limits, mint an attributed session.
async function accessLink(request: Request, ctx: DataContext, presId: string, lnkId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const link = await loadLink(ctx, presId, lnkId);
  if (!link) return errorResponse({ code: 'LINK_NOT_FOUND', message: 'Link not found', status: 404 });
  if (link.revoked === 1) return errorResponse({ code: 'LINK_REVOKED', message: 'This link has been revoked', status: 410 });
  if (link.expires_at && link.expires_at < new Date().toISOString()) {
    return errorResponse({ code: 'LINK_EXPIRED', message: 'This link has expired', status: 410 });
  }

  let body: { email?: string; password?: string };
  try { body = await request.json(); } catch { body = {}; }

  const gate = link.gate as Gate;
  let viewerEmail: string | null = null;

  if (gate === 'email' || gate === 'domain') {
    const email = (body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return errorResponse({ code: 'EMAIL_REQUIRED', message: 'A valid email is required', status: 401, hint: gate });
    }
    if (gate === 'domain') {
      const domain = email.split('@')[1];
      const allowed = (link.gate_value || '').split(',').filter(Boolean);
      if (!allowed.includes(domain)) {
        return errorResponse({ code: 'DOMAIN_NOT_ALLOWED', message: 'Your email domain is not permitted', status: 403 });
      }
    }
    viewerEmail = email;
  } else if (gate === 'password') {
    if (!body.password || (await hashPassword(body.password)) !== link.gate_value) {
      return errorResponse({ code: 'INVALID_PASSWORD', message: 'Incorrect password', status: 401, hint: 'password' });
    }
  }

  // Enforce the view cap on *unique sessions* attributed to this link.
  if (link.max_views != null) {
    const used = await ctx.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM view_sessions WHERE link_id = ?`
    ).bind(lnkId).first<{ n: number }>();
    if ((used?.n ?? 0) >= link.max_views) {
      return errorResponse({ code: 'VIEW_LIMIT_REACHED', message: 'This link has reached its view limit', status: 403 });
    }
  }

  const sessionId = generateId('ses');
  const now = new Date().toISOString();
  const rawIp = request.headers.get('CF-Connecting-IP') || '';
  const dnt = request.headers.get('DNT') === '1';
  const ipHash = dnt || !rawIp ? null : (await sha256(new TextEncoder().encode(`${rawIp}:${presId}`).buffer as ArrayBuffer)).slice(0, 32);
  const ua = dnt ? null : (request.headers.get('User-Agent') || '').slice(0, 400);
  const country = dnt ? null : ((request as { cf?: { country?: string } }).cf?.country ?? null);

  await ctx.env.DB.prepare(
    `INSERT INTO view_sessions (id, presentation_id, artifact_id, viewer_email, link_id, ip_hash, user_agent, country, started_at, last_seen_at, completed, duration_ms, slides_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`
  ).bind(sessionId, presId, ctx.artifactId, viewerEmail, lnkId, ipHash, ua, country, now, now).run();

  await notifyOwnerOnOpen(ctx, presId, lnkId, sessionId, link.recipient_label, viewerEmail).catch(() => {});

  return successResponse({ sessionId, granted: true, recipientLabel: link.recipient_label }, 200, ctx.origin);
}

// "Acme just opened your proposal." Fires to the deck owner on a tracked-link
// open (P2). Deduped to one email per link per 30 min so a refresh doesn't spam.
async function notifyOwnerOnOpen(
  ctx: DataContext,
  presId: string,
  lnkId: string,
  sessionId: string,
  recipientLabel: string | null,
  viewerEmail: string | null,
): Promise<void> {
  const ownerId = ctx.artifact.owner_id;
  if (!ownerId) return;

  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const recent = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM view_sessions WHERE link_id = ? AND id != ? AND started_at >= ?`
  ).bind(lnkId, sessionId, cutoff).first<{ n: number }>();
  if ((recent?.n ?? 0) > 0) return; // within cooldown — stay quiet

  const pres = await ctx.env.DB.prepare(`SELECT title FROM presentations WHERE id = ?`)
    .bind(presId).first<{ title: string }>();

  await dispatchLifecycleEmail(ctx.env, {
    type: 'slides_deck_opened',
    toUserId: ownerId,
    data: {
      deckName: pres?.title || ctx.artifact.name,
      recipientLabel,
      viewerEmail,
      url: `${ctx.env.SHAREOUT_BASE_URL}/a/${ctx.artifact.name}`,
    },
  });
}
