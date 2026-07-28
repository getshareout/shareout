import type { FetchContext } from '../context';
import { hashVisitor } from '../../analytics';

// Live-presence heartbeat sink. The presence beacon (anonymous, fired from a sandboxed
// iframe on the content domain) POSTs here every ~20s. We resolve a coarse viewer id
// server-side — the same date-bucketed hash(ip, ua) the perf/analytics path uses, since
// the cross-origin content domain carries no session cookie — and forward a `beat` to
// the artifact's PresenceCoordinator DO. Always 204, drop bad input silently (mirrors
// /v1/perf). Body is text/plain JSON to stay a CORS-safelisted simple request.

const ARTIFACT_ID = /^art_[a-f0-9]{6,40}$/;

export async function routePresenceApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS, executionCtx } = ctx;
  if (path !== '/v1/presence' || request.method !== 'POST') return null;

  const ok = () => addCORS(new Response(null, { status: 204 }));

  let body: { a?: string };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return ok();
  }

  const artifactId = (body.a || '').toString();
  if (!ARTIFACT_ID.test(artifactId)) return ok();

  const ip = request.headers.get('cf-connecting-ip') || '';
  const userAgent = request.headers.get('user-agent') || '';

  const beat = (async () => {
    try {
      const viewerId = await hashVisitor(ip, userAgent);
      const stub = env.PRESENCE.get(env.PRESENCE.idFromName(artifactId));
      await stub.fetch('https://presence/beat', {
        method: 'POST',
        body: JSON.stringify({ viewerId }),
      });
    } catch {
      // DO unreachable or hash failure — a dropped heartbeat is harmless.
    }
  })();

  if (executionCtx) executionCtx.waitUntil(beat); else await beat;
  return ok();
}
