import type { FetchContext } from '../context';

// Lightweight landing-funnel beacon. No auth — anonymous visitors fire these.
// Tracks the path to the only conversion that matters: focus → keystroke → submit.
const ALLOWED_EVENTS = new Set([
  // shared
  'view', 'mode', 'examples_open', 'examples_back',
  // personal funnel
  'focus', 'keystroke', 'chip', 'submit',
  // teams funnel (kept fully separate so each flow breaks down on its own)
  'teams_focus', 'teams_keystroke', 'teams_claim', 'teams_talk',
  'teams_section', 'teams_preview', 'teams_pricing_view', 'teams_plan_select', 'teams_contact',
  // agents funnel
  'agents_section', 'agents_copy_skill',
]);

export async function routeFunnelApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;
  if (path !== '/v1/funnel' || request.method !== 'POST') return null;

  // Always 204 — analytics must never surface errors to the visitor.
  const ok = () => addCORS(new Response(null, { status: 204 }));

  let body: { event?: string; mode?: string; sid?: string; label?: string; typed?: number; len?: number };
  try {
    body = await request.json();
  } catch {
    return ok();
  }

  const event = (body.event || '').toString();
  if (!ALLOWED_EVENTS.has(event)) return ok();

  const mode =
    body.mode === 'personal' ? 'personal' : body.mode === 'business' ? 'business' : body.mode === 'agents' ? 'agents' : null;
  const sid = (body.sid || '').toString().slice(0, 40) || null;
  const label = body.label != null ? body.label.toString().slice(0, 60) : null;
  const meta =
    event === 'submit'
      ? JSON.stringify({ typed: body.typed ? 1 : 0, len: Math.min(2000, Math.max(0, Number(body.len) || 0)) })
      : null;
  const country = (request as Request & { cf?: { country?: string } }).cf?.country || null;

  try {
    await env.DB.prepare(
      'INSERT INTO funnel_events (event, mode, sid, label, meta, country) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(event, mode, sid, label, meta, country)
      .run();
  } catch {
    // Table missing or write failed — drop silently.
  }

  return ok();
}
