import type { Env } from './types';
import { SDK_IMMUTABLE_CACHE } from './sdk-version';

// Lazy editable-grid UI (Tabulator wrapper + ShareOut theme), staged as a
// Workers Static Asset by scripts/stage-grid-bundle.mjs. Kept out of the core
// SDK bundle and loaded on demand by Grid.render(). See specs/editable-grid.md.
const GRID_JS_ASSET = '/_bundles/grid.js';
const GRID_CSS_ASSET = '/_bundles/grid.css';

async function serveAsset(
  request: Request,
  env: Env,
  asset: string,
  contentType: string,
  immutable: boolean
): Promise<Response> {
  const res = await env.ASSETS.fetch(new URL(asset, request.url));
  if (!res.ok) return new Response('Grid bundle not found', { status: 404 });
  return new Response(res.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': immutable ? SDK_IMMUTABLE_CACHE : 'public, max-age=300, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export function handleServeGridJS(request: Request, env: Env, immutable = false): Promise<Response> {
  return serveAsset(request, env, GRID_JS_ASSET, 'application/javascript', immutable);
}

export function handleServeGridCSS(request: Request, env: Env, immutable = false): Promise<Response> {
  return serveAsset(request, env, GRID_CSS_ASSET, 'text/css; charset=utf-8', immutable);
}
