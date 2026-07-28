import type { Env } from './types';
import { SDK_IMMUTABLE_CACHE } from './sdk-version';

// Mobile SDK (PWA gestures, haptics, navigation) built from sdk/src/mobile/ and staged
// as a Workers Static Asset at public/_bundles/shareout-mobile.js.
const MOBILE_SDK_ASSET = '/_bundles/shareout-mobile.js';

export async function handleServeMobileSDK(
  request: Request,
  env: Env,
  immutable = false,
): Promise<Response> {
  const secFetchDest = request.headers.get('Sec-Fetch-Dest');
  const secFetchMode = request.headers.get('Sec-Fetch-Mode');

  if (secFetchDest === 'document' || secFetchMode === 'navigate') {
    return new Response('Forbidden', { status: 403 });
  }

  const asset = await env.ASSETS.fetch(new URL(MOBILE_SDK_ASSET, request.url));
  if (!asset.ok) {
    return new Response('Mobile SDK bundle not found', { status: 404 });
  }

  return new Response(asset.body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': immutable ? SDK_IMMUTABLE_CACHE : 'public, max-age=86400, s-maxage=604800',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
