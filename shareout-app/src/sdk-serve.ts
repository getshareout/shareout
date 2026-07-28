import type { Env } from './types';
import { SDK_IMMUTABLE_CACHE } from './sdk-version';

// The browser SDK is built from sdk/ and staged as a Workers Static Asset
// (public/_bundles/shareout-sdk.js, via scripts/stage-sdk-bundle.mjs, with the
// global-unwrap fix already appended). Served from the ASSETS binding to keep
// ~160 KB of generated JS out of the worker script bundle (plan §19 Phase 4).
const SDK_ASSET = '/_bundles/shareout-sdk.js';
const COMMENTS_AGENT_ASSET = '/_bundles/shareout-comments-agent.js';
const CHAT_CORE_ASSET = '/_bundles/chat-core.js';
const PAGE_PILOT_ASSET = '/_bundles/page-pilot.js';

export async function handleServeCommentsAgent(request: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(new URL(COMMENTS_AGENT_ASSET, request.url));
  if (!asset.ok) {
    return new Response('Comments agent bundle not found', { status: 404 });
  }
  return new Response(asset.body, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=300, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Shared chat primitives (SSE loop, message view, composer) used by the home and
// create chats. Built from chat-core/ and staged at public/_bundles/chat-core.js.
export async function handleServeChatCore(request: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(new URL(CHAT_CORE_ASSET, request.url));
  if (!asset.ok) {
    return new Response('Chat core bundle not found', { status: 404 });
  }
  return new Response(asset.body, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=300, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// page-agent (alibaba's in-page GUI agent, MIT) bundled as a self-hosted IIFE.
// Built by scripts/build-page-pilot.mjs and staged at public/_bundles/page-pilot.js.
// Exposes the PagePilot global; served at /sdk/page-pilot.js.
export async function handleServePagePilot(request: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(new URL(PAGE_PILOT_ASSET, request.url));
  if (!asset.ok) {
    return new Response('PagePilot bundle not found', { status: 404 });
  }
  return new Response(asset.body, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=300, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function handleServeSDK(request: Request, env: Env, immutable = false): Promise<Response> {
  const secFetchDest = request.headers.get('Sec-Fetch-Dest');
  const secFetchMode = request.headers.get('Sec-Fetch-Mode');

  if (secFetchDest === 'document' || secFetchMode === 'navigate') {
    return new Response('Forbidden', { status: 403 });
  }

  const asset = await env.ASSETS.fetch(new URL(SDK_ASSET, request.url));
  if (!asset.ok) {
    return new Response('SDK bundle not found', { status: 404 });
  }

  return new Response(asset.body, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': immutable ? SDK_IMMUTABLE_CACHE : 'public, max-age=300, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
