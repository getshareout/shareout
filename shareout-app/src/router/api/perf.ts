import type { FetchContext } from '../context';
import { hashVisitor } from '../../analytics';

// Real-user load-time beacon (opt-017). No auth — anonymous artifact viewers fire these
// from a sandboxed iframe. Body is a text/plain JSON blob (keeps it a CORS-safelisted
// simple request so sendBeacon needs no preflight). Mirrors /v1/funnel: always 204,
// never surface an error to the viewer, drop bad input silently.

const ARTIFACT_ID = /^art_[a-f0-9]{6,40}$/;
const MAX_MS = 60000;

// Finite, in-range millisecond timing → integer, else null. Negatives/garbage/overflow
// are dropped rather than poisoning the percentile.
function ms(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MS) return null;
  return Math.round(n);
}

export async function routePerfApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS, executionCtx } = ctx;
  if (path !== '/v1/perf' || request.method !== 'POST') return null;

  const ok = () => addCORS(new Response(null, { status: 204 }));

  let body: { a?: string; fcp?: unknown; lcp?: unknown; dcl?: unknown; ttfb?: unknown };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return ok();
  }

  const artifactId = (body.a || '').toString();
  if (!ARTIFACT_ID.test(artifactId)) return ok();

  const fcp = ms(body.fcp);
  // FCP is the floor signal — no paint means nothing worth recording (matches the
  // client's send-if-FCP guard; a row with no FCP is noise).
  if (fcp === null) return ok();

  const lcp = ms(body.lcp);
  const dcl = ms(body.dcl);
  const ttfb = ms(body.ttfb);

  // Resolve viewer identity server-side from the request (the client can't be trusted
  // with it), exactly like trackPageView. Date-bucketed hash → rough unique sampling.
  const ip = request.headers.get('cf-connecting-ip') || '';
  const userAgent = request.headers.get('user-agent') || '';
  const country = (request as Request & { cf?: { country?: string } }).cf?.country || 'XX';

  const write = (async () => {
    try {
      const visitorHash = await hashVisitor(ip, userAgent);
      await env.DB.prepare(`
        INSERT INTO artifact_perf (id, artifact_id, created_at, fcp, lcp, dcl, ttfb, visitor_hash, country)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        artifactId,
        new Date().toISOString(),
        fcp, lcp, dcl, ttfb,
        visitorHash,
        country,
      ).run();
    } catch {
      // Table missing, FK violation (unknown artifact), or write failure — drop silently.
    }
  })();

  // Hand the write off past the 204 so the beacon round-trip stays instant.
  if (executionCtx) executionCtx.waitUntil(write); else await write;
  return ok();
}
