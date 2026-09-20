import type { Env } from '../types';
import {
  parseVendorPath,
  upstreamUrl,
  vendorMime,
  vendorR2Key,
  VENDOR_PREFIX,
  type VendorRef,
} from './registry';

/** Opt-out knob for instances that would rather every viewer hit the public CDN. */
export function vendorLibsEnabled(env: Env): boolean {
  return env.VENDOR_LIBS_DISABLED !== '1';
}

function vendorResponse(body: BodyInit, ref: VendorRef, size?: number): Response {
  const headers = new Headers({
    'Content-Type': vendorMime(ref.file),
    // Version-addressed bytes: a different version is a different key, so this can
    // never go stale.
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: `"${vendorR2Key(ref)}"`,
    'X-Content-Type-Options': 'nosniff',
    // Artifacts live on per-artifact content hosts, so every load of these is
    // cross-origin from somewhere.
    'Access-Control-Allow-Origin': '*',
  });
  if (size !== undefined) headers.set('Content-Length', String(size));
  return new Response(body, { status: 200, headers });
}

/**
 * Serve `/vendor/<pkg>@<version>/<file>`.
 *
 * Warm path: the bytes are in R2 and go straight out (the shared-bundle edge cache in
 * front of this means most colos never even reach R2). Cold path: pull once from
 * jsdelivr, answer from memory and store to R2 out of band.
 *
 * If upstream is unreachable we redirect to it rather than 404 — a viewer whose chart
 * library fails to load has a broken artifact, and the pre-vendoring behaviour (the
 * browser fetching the CDN directly) is exactly that redirect.
 */
export async function handleServeVendorLib(
  request: Request,
  env: Env,
  path: string,
  executionCtx?: ExecutionContext,
): Promise<Response | null> {
  if (!path.startsWith(VENDOR_PREFIX)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const ref = parseVendorPath(path);
  if (!ref) return new Response('Not Found', { status: 404 });

  const upstream = upstreamUrl(ref);
  if (!vendorLibsEnabled(env)) return Response.redirect(upstream, 302);

  const key = vendorR2Key(ref);
  const stored = await env.ARTIFACTS.get(key);
  if (stored) return vendorResponse(stored.body, ref, stored.size);

  let bytes: ArrayBuffer;
  try {
    const res = await fetch(upstream, { headers: { Accept: '*/*' } });
    if (!res.ok) return Response.redirect(upstream, 302);
    bytes = await res.arrayBuffer();
  } catch {
    return Response.redirect(upstream, 302);
  }

  const write = env.ARTIFACTS.put(key, bytes, {
    httpMetadata: { contentType: vendorMime(ref.file), cacheControl: 'public, max-age=31536000, immutable' },
    customMetadata: { upstream },
  }).then(() => {}, () => {});
  if (executionCtx) executionCtx.waitUntil(write);

  return vendorResponse(bytes, ref, bytes.byteLength);
}
