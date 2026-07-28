import type { Env } from '../types';
import { getAdminPulse, getAnalystContext, getAdminEvents } from '../superadmin/pulse';
import { chatComplete, getBuildConfig } from '../data/agent/anthropic';
import { logInternalAdminFailure, userFacingAnalystFailure } from '../data/agent/errors';
import { getRecentWebhooks, getRecentErrors } from '../observability/store';
import { checkAdminBridgeAskLimit, rateLimitResponse } from '../rate-limit';

const ANALYST_SYSTEM = `You are the data analyst for ShareOut (a platform for publishing interactive artifacts). The owner asks business questions over Telegram. Answer ONLY from the JSON snapshot provided. If the answer isn't in the data, say "I don't have that yet" and name what extra data would be needed. Be concise (a Telegram message), lead with the number, no preamble, no markdown headers. Money in USD.`;

// Worker-to-worker admin bridge. Called by the headless-email super-admin bot to
// pull ShareOut platform data. Authenticated by a shared Bearer secret, NOT by a
// browser session. No CSRF/cookies. Reads are GET; POST /ask is rate-limited.
function authorized(request: Request, env: Env): boolean {
  const expected = env.ADMIN_BRIDGE_SECRET;
  if (!expected) return false;
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Routes under /internal/admin/*. Returns null if the path is not handled here. */
export async function routeInternalAdmin(request: Request, env: Env, path: string): Promise<Response | null> {
  if (!path.startsWith('/internal/admin/')) return null;

  if (!authorized(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (path === '/internal/admin/stats' && request.method === 'GET') {
    const pulse = await getAdminPulse(env);
    return Response.json(pulse);
  }

  if (path === '/internal/admin/context' && request.method === 'GET') {
    return Response.json(await getAnalystContext(env));
  }

  if (path === '/internal/admin/events' && request.method === 'GET') {
    const url = new URL(request.url);
    const since = Number(url.searchParams.get('since') || '0');
    return Response.json(await getAdminEvents(env, Number.isFinite(since) ? since : 0));
  }

  if (path === '/internal/admin/logs' && request.method === 'GET') {
    const url = new URL(request.url);
    const source = url.searchParams.get('source') ?? undefined;
    const limit = Math.min(Number(url.searchParams.get('limit') || '20'), 50);
    const [webhooks, errors] = await Promise.all([
      getRecentWebhooks(env, limit, source),
      source ? Promise.resolve([]) : getRecentErrors(env, 10),
    ]);
    return Response.json({ webhooks, errors });
  }

  if (path === '/internal/admin/ask' && request.method === 'POST') {
    const rl = await checkAdminBridgeAskLimit(env);
    if (!rl.allowed) return rateLimitResponse(rl);
    const { question } = (await request.json().catch(() => ({}))) as { question?: string };
    if (!question?.trim()) return Response.json({ error: 'question required' }, { status: 400 });
    try {
      const ctx = await getAnalystContext(env);
      const answer = await chatComplete(
        env,
        [{ role: 'user', content: `Question: ${question}\n\nSnapshot JSON:\n${JSON.stringify(ctx)}` }],
        ANALYST_SYSTEM,
        500,
        getBuildConfig(env)
      );
      return Response.json({ answer: answer.trim() || 'No answer.' });
    } catch (err) {
      logInternalAdminFailure(env, 'analyst ask failed', err, { route: 'ask' });
      return Response.json({ error: userFacingAnalystFailure(err) }, { status: 500 });
    }
  }

  return new Response('Not Found', { status: 404 });
}
