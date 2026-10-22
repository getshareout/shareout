import type { FetchContext } from '../router/context';
import type { Env } from '../types';
import { getSessionUser } from '../auth/session';
import { colors, fonts, radius } from '../../packages/design-tokens/src/index';
import { addSuppression, removeSuppression } from './suppressions';
import { verifyUnsubscribeToken } from './unsubscribe-token';
import { verifyArtifactOptoutToken, addArtifactOptout, removeArtifactOptout, optedOutSet } from './artifact-optout';
import { getPreferences, setPreference, type EmailCategory } from './preferences';
import { jsonWithApiErrors } from '../http/api-error';

const CATEGORY_LABELS: Record<string, { title: string; desc: string }> = {
  product: { title: 'Product & collaboration', desc: 'Comments, shares, approvals, and activity on your pages.' },
  commercial: { title: 'Plan & billing', desc: 'Trials, plan changes, and account limits.' },
  marketing: { title: 'Tips & updates', desc: 'Weekly digest and occasional product news.' },
};

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

function page(title: string, inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:${colors.bg};font-family:${fonts.body};color:${colors.text}">
  <div style="max-width:520px;margin:0 auto;padding:48px 24px">
    <div style="font-family:${fonts.display};font-weight:700;font-size:18px;margin-bottom:24px">ShareOut</div>
    <div style="background:${colors.bgElevated};border:1px solid ${colors.border};border-radius:${radius.md};padding:28px">${inner}</div>
  </div>
</body></html>`;
}

function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// POST /v1/webhooks/email-events — Cloudflare Email Sending delivery events.
// Secured by EMAIL_WEBHOOK_SECRET (header x-webhook-secret or ?secret=); without the
// secret configured the endpoint is off. Maps bounces/complaints onto the suppression list.
async function handleEmailEventWebhook(req: Request, env: Env, url: URL): Promise<Response> {
  const secret = env.EMAIL_WEBHOOK_SECRET;
  if (!secret) return new Response('Not Found', { status: 404 });
  const provided = req.headers.get('x-webhook-secret') || url.searchParams.get('secret') || '';
  if (!secretMatches(provided, secret)) return new Response('Unauthorized', { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const events = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : [body];
  let suppressed = 0;
  for (const ev of events) {
    const email = ev?.email || ev?.recipient || ev?.to || ev?.destination;
    const rawType = String(ev?.type || ev?.event || ev?.notificationType || '').toLowerCase();
    if (!email) continue;
    if (rawType.includes('bounce') || rawType.includes('dropped') || rawType.includes('fail')) {
      await addSuppression(env, { email, reason: 'bounce', kind: 'hard' });
      suppressed++;
    } else if (rawType.includes('complaint') || rawType.includes('spam')) {
      await addSuppression(env, { email, reason: 'complaint', kind: 'spam' });
      suppressed++;
    }
  }
  return json({ ok: true, suppressed });
}

const OPTOUT_COPY = {
  en: { lang: 'en', title: 'Unsubscribe', ask: (n: string) => `Stop emails from “${n}”?`, askBody: 'You will stop receiving this notice. Other emails from ShareOut are not affected.', unsub: 'Unsubscribe', done: 'You are unsubscribed', doneBody: (n: string) => `You will no longer receive emails from “${n}”.`, resub: 'Subscribe again', again: 'You are subscribed again', againBody: (n: string) => `You will receive emails from “${n}” again.`, invalid: 'This link is invalid or expired.', already: 'You are currently unsubscribed from this notice.' },
  es: { lang: 'es-AR', title: 'Darte de baja', ask: (n: string) => `¿Dejar de recibir los avisos de “${n}”?`, askBody: 'Vas a dejar de recibir este aviso. Los demás mails de ShareOut no se ven afectados.', unsub: 'Darte de baja', done: 'Ya te diste de baja', doneBody: (n: string) => `No vas a recibir más mails de “${n}”.`, resub: 'Volver a suscribirte', again: 'Volviste a suscribirte', againBody: (n: string) => `Vas a volver a recibir los mails de “${n}”.`, invalid: 'Este enlace no es válido o venció.', already: 'Ahora mismo estás dado de baja de este aviso.' },
};
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function optoutPage(c: (typeof OPTOUT_COPY)['en'], inner: string, status = 200): Response {
  const res = html(page(c.title, inner).replace('<html lang="en">', `<html lang="${c.lang}">`), status);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

// GET/POST /v1/email/artifact-unsubscribe?token= — per-artifact opt-out. GET only shows a confirmation
// form (mail scanners prefetch links and must not unsubscribe anyone); POST acts (RFC 8058 one-click or
// the form), and the result page offers opting back in. The token is the only credential; no redirects.
async function handleArtifactUnsubscribe(ctx: FetchContext): Promise<Response> {
  const token = ctx.url.searchParams.get('token') || '';
  const parsed = await verifyArtifactOptoutToken(ctx.env, token);
  const art = parsed
    ? await ctx.env.DB.prepare('SELECT a.name, w.locale FROM artifacts a LEFT JOIN workspaces w ON w.id = a.workspace_id WHERE a.id = ?')
        .bind(parsed.artifactId).first<{ name: string; locale: string | null }>()
    : null;
  if (!parsed || !art) {
    return optoutPage(OPTOUT_COPY.en, `<p style="margin:0;color:${colors.textSecondary}">${OPTOUT_COPY.en.invalid}</p>`, 400);
  }
  const c = art.locale === 'es' ? OPTOUT_COPY.es : OPTOUT_COPY.en;
  const name = escHtml(art.name || '');
  const action = `/v1/email/artifact-unsubscribe?token=${encodeURIComponent(token)}`;
  const button = (value: string, label: string) =>
    `<form method="post" action="${action}" style="margin:0"><input type="hidden" name="action" value="${value}"><button type="submit" style="background:${colors.primary};color:${colors.textInverse};border:0;font-weight:600;padding:10px 20px;border-radius:${radius.sm};cursor:pointer;font:inherit">${label}</button></form>`;
  const h1 = (t: string) => `<h1 style="margin:0 0 8px;font-family:${fonts.display};font-size:20px">${t}</h1>`;
  const p = (t: string) => `<p style="margin:0 0 16px;color:${colors.textSecondary}">${t}</p>`;

  if (ctx.request.method === 'POST') {
    const form = new URLSearchParams(await ctx.request.text().catch(() => ''));
    if (form.get('action') === 'resubscribe') {
      await removeArtifactOptout(ctx.env, parsed.artifactId, parsed.email);
      return optoutPage(c, h1(c.again) + p(c.againBody(name)));
    }
    await addArtifactOptout(ctx.env, parsed.artifactId, parsed.email);
    // Mailbox-provider one-click POSTs expect a bare 200.
    if (form.has('List-Unsubscribe')) return new Response('OK', { status: 200 });
    return optoutPage(c, h1(c.done) + p(c.doneBody(name)) + button('resubscribe', c.resub));
  }
  const already = (await optedOutSet(ctx.env, parsed.artifactId, [parsed.email])).size > 0;
  return optoutPage(c, already
    ? h1(c.done) + p(c.already) + button('resubscribe', c.resub)
    : h1(c.ask(name)) + p(c.askBody) + button('unsubscribe', c.unsub));
}

// GET/POST /v1/email/unsubscribe?token= — one-click unsubscribe (RFC 8058).
async function handleUnsubscribe(ctx: FetchContext): Promise<Response> {
  const token = ctx.url.searchParams.get('token') || '';
  const parsed = await verifyUnsubscribeToken(ctx.env, token);
  if (!parsed) {
    return html(page('Unsubscribe', `<p style="margin:0;color:${colors.textSecondary}">This unsubscribe link is invalid or expired.</p>`), 400);
  }
  await setPreference(ctx.env, parsed.userId, parsed.category, false);
  // Mailbox-provider one-click POSTs expect a bare 200.
  if (ctx.request.method === 'POST') return new Response('OK', { status: 200 });
  const label = CATEGORY_LABELS[parsed.category]?.title || parsed.category;
  return html(
    page(
      'Unsubscribed',
      `<h1 style="margin:0 0 8px;font-family:${fonts.display};font-size:20px">You're unsubscribed</h1>
       <p style="margin:0 0 16px;color:${colors.textSecondary}">You'll no longer receive <strong>${label}</strong> emails. You can change this anytime in your email preferences.</p>
       <a href="${ctx.env.SHAREOUT_BASE_URL}/v1/email/center" style="display:inline-block;background:${colors.primary};color:${colors.textInverse};text-decoration:none;font-weight:600;padding:10px 20px;border-radius:${radius.sm}">Manage preferences</a>`,
    ),
  );
}

// GET /v1/email/preferences — JSON for the signed-in user.
// POST /v1/email/preferences { category, optedIn } — update one toggle.
async function handlePreferencesApi(ctx: FetchContext): Promise<Response> {
  const user = await getSessionUser(ctx.request, ctx.env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  if (ctx.request.method === 'GET') {
    return json({ preferences: await getPreferences(ctx.env, user.id) });
  }
  const body = (await ctx.request.json().catch(() => ({}))) as { category?: string; optedIn?: boolean };
  const valid: EmailCategory[] = ['product', 'commercial', 'marketing'];
  if (!valid.includes(body.category as EmailCategory) || typeof body.optedIn !== 'boolean') {
    return json({ error: 'category and optedIn required' }, 400);
  }
  await setPreference(ctx.env, user.id, body.category as EmailCategory, body.optedIn);
  if (body.optedIn && user.email) await removeSuppression(ctx.env, user.email);
  return json({ ok: true });
}

// GET /v1/email/center — the preference center page (session-gated).
async function handleCenter(ctx: FetchContext): Promise<Response> {
  const user = await getSessionUser(ctx.request, ctx.env);
  if (!user) {
    return html(page('Email preferences', `<p style="margin:0;color:${colors.textSecondary}">Please <a href="${ctx.env.SHAREOUT_BASE_URL}/home" style="color:${colors.primary}">sign in</a> to manage your email preferences.</p>`), 401);
  }
  const prefs = await getPreferences(ctx.env, user.id);
  const rows = prefs
    .map((p) => {
      const meta = CATEGORY_LABELS[p.category];
      return `<label style="display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-top:1px solid ${colors.border}">
        <input type="checkbox" data-cat="${p.category}" ${p.optedIn ? 'checked' : ''} style="margin-top:3px">
        <span><span style="font-weight:600">${meta.title}</span><br><span style="font-size:13px;color:${colors.textSecondary}">${meta.desc}</span></span>
      </label>`;
    })
    .join('');
  const script = `<script>
    document.querySelectorAll('input[data-cat]').forEach(function(el){
      el.addEventListener('change', function(){
        fetch('/v1/email/preferences', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:el.dataset.cat,optedIn:el.checked})});
      });
    });
  </script>`;
  return html(
    page(
      'Email preferences',
      `<h1 style="margin:0 0 4px;font-family:${fonts.display};font-size:20px">Email preferences</h1>
       <p style="margin:0 0 8px;color:${colors.textSecondary};font-size:14px">${user.email || ''}. Account and security emails are always sent.</p>
       ${rows}${script}`,
    ),
  );
}

/** Routes under /v1/email/* and the email-events webhook. Returns null if unmatched. */
export async function routeEmail(ctx: FetchContext): Promise<Response | null> {
  const { path, request } = ctx;
  if (path === '/v1/webhooks/email-events' && request.method === 'POST') {
    return handleEmailEventWebhook(request, ctx.env, ctx.url);
  }
  if (path === '/v1/email/unsubscribe') return handleUnsubscribe(ctx);
  if (path === '/v1/email/artifact-unsubscribe') return handleArtifactUnsubscribe(ctx);
  if (path === '/v1/email/preferences') return handlePreferencesApi(ctx);
  if (path === '/v1/email/center') return handleCenter(ctx);
  return null;
}
