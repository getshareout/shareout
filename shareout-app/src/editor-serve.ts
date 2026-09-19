import type { Env } from './types';
import { SDK_IMMUTABLE_CACHE } from './sdk-version';

// The editor client bundle is staged as a Workers Static Asset
// (public/_bundles/editor.js, via scripts/stage-editor-bundle.mjs) and served from
// the ASSETS binding, keeping ~0.5 MB of generated JS out of the worker script
// bundle (plan §19 Phase 4).
const EDITOR_BUNDLE_ASSET = '/_bundles/editor.js';

export async function handleServeEditor(request: Request, env: Env, immutable = false): Promise<Response> {
  const secFetchDest = request.headers.get('Sec-Fetch-Dest');
  const secFetchMode = request.headers.get('Sec-Fetch-Mode');

  if (secFetchDest === 'document' || secFetchMode === 'navigate') {
    return new Response('Forbidden', { status: 403 });
  }

  const asset = await env.ASSETS.fetch(new URL(EDITOR_BUNDLE_ASSET, request.url));
  if (!asset.ok) {
    return new Response('Editor bundle not found', { status: 404 });
  }

  return new Response(asset.body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': immutable ? SDK_IMMUTABLE_CACHE : 'public, max-age=300, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
