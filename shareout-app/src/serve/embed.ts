import type { Env, TypeMetadata } from '../types';
import type { EmbedArtifactInfo } from './types';
import { SANDBOX_PERMISSIONS, getEmbedCSP, getEmbedSecurityHeaders } from './security';
import { escapeHtml, notFound, pausedPage } from './utils';
import { getCacheControl } from './assets';
import { googleFontsPreconnect, standalonePageStyles } from '../design-system/standalone-page';
import { hasCustomViewer, renderViewer } from '../viewers';
import { getPlatformOrigin } from '../config/origins';

export async function handleServeEmbed(
  request: Request,
  env: Env,
  slug: string,
  assetPath: string
): Promise<Response> {
  const url = new URL(request.url);
  const isRawRequest = url.searchParams.has('_raw');

  const result = await env.DB.prepare(`
    SELECT d.version_id, v.entrypoint, v.mobile_entrypoint, v.artifact_id, a.name as artifact_name,
           a.visibility, a.auth_method, a.owner_id, a.paused,
           COALESCE(pres_a.has_mobile, 0) AS has_mobile, pres_a.pwa_config,
           COALESCE(pres_a.embed_allowed, 1) AS embed_allowed, pres_a.embed_origins,
           a.artifact_type, a.type_metadata,
           ast.r2_key, ast.mime, ast.size_bytes
    FROM deployments d
    JOIN versions v ON v.id = d.version_id
    JOIN artifacts a ON a.id = v.artifact_id
    LEFT JOIN artifact_presentation pres_a ON pres_a.artifact_id = a.id
    LEFT JOIN assets ast ON ast.version_id = v.id
      AND ast.path = COALESCE(?, v.entrypoint)
    WHERE d.slug = ? AND d.channel = 'production'
  `).bind(assetPath || null, slug).first<EmbedArtifactInfo>();

  if (!result) {
    return notFound();
  }

  if (result.paused === 1) {
    return pausedPage(result.artifact_name);
  }

  if (result.embed_allowed !== 1) {
    return new Response('Embedding disabled for this artifact', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  if (result.visibility === 'private' || result.visibility === 'workspace') {
    return embedPrivateNotAllowed(slug, env);
  }

  let allowedOrigins: string[] | null = null;
  if (result.embed_origins) {
    try {
      allowedOrigins = JSON.parse(result.embed_origins);
    } catch {
      allowedOrigins = null;
    }
  }

  if (allowedOrigins && allowedOrigins.length > 0) {
    const requestOrigin = request.headers.get('Origin') || request.headers.get('Referer');
    if (requestOrigin) {
      try {
        const originUrl = new URL(requestOrigin);
        const originBase = `${originUrl.protocol}//${originUrl.host}`;
        if (!allowedOrigins.includes(originBase) && !allowedOrigins.includes('*')) {
          return new Response('Origin not allowed', { status: 403 });
        }
      } catch {
        // Invalid origin URL, allow through
      }
    }
  }

  if (result.r2_key && result.mime && result.size_bytes) {
    const artifactType = result.artifact_type || 'html';
    if (!assetPath && !isRawRequest && hasCustomViewer(artifactType)) {
      return serveEmbedTypeViewer(env, slug, result, allowedOrigins);
    }
    if (result.mime === 'text/html' && !assetPath && !isRawRequest) {
      return serveEmbedViewer(env, slug, result.entrypoint, allowedOrigins);
    }
    return serveEmbedAsset(env, { r2_key: result.r2_key, mime: result.mime, size_bytes: result.size_bytes }, allowedOrigins);
  }

  return notFound();
}

async function serveEmbedTypeViewer(
  env: Env,
  slug: string,
  result: EmbedArtifactInfo,
  allowedOrigins: string[] | null
): Promise<Response> {
  const obj = await env.ARTIFACTS.get(result.r2_key!);
  if (!obj) {
    return notFound();
  }
  const content = await obj.text();

  let typeMetadata: TypeMetadata = {};
  if (result.type_metadata) {
    try {
      typeMetadata = JSON.parse(result.type_metadata);
    } catch {
      // Invalid metadata, use empty
    }
  }

  const baseUrl = getPlatformOrigin(env);
  const html = renderViewer(
    result.artifact_type,
    slug,
    result.artifact_name,
    typeMetadata,
    baseUrl,
    content,
    false,
    result.artifact_id,
    false,
    false,
  );

  if (!html) {
    return serveEmbedAsset(env, { r2_key: result.r2_key!, mime: result.mime!, size_bytes: result.size_bytes! }, allowedOrigins);
  }

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Content-Security-Policy': getEmbedCSP(allowedOrigins, env),
      ...getEmbedSecurityHeaders(),
    },
  });
}

async function serveEmbedViewer(
  env: Env,
  slug: string,
  entrypoint: string,
  allowedOrigins: string[] | null
): Promise<Response> {
  const baseUrl = getPlatformOrigin(env);
  const rawUrl = `${baseUrl}/embed/${slug}/${entrypoint}?_raw`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${escapeHtml(slug)} - ShareOut Embed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe
    src="${escapeHtml(rawUrl)}"
    sandbox="${SANDBOX_PERMISSIONS}"
    allow="clipboard-write"
    loading="eager"
  ></iframe>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Content-Security-Policy': getEmbedCSP(allowedOrigins, env),
      ...getEmbedSecurityHeaders(),
    },
  });
}

async function serveEmbedAsset(
  env: Env,
  asset: { r2_key: string; mime: string; size_bytes: number },
  allowedOrigins: string[] | null
): Promise<Response> {
  const obj = await env.ARTIFACTS.get(asset.r2_key);
  if (!obj) {
    return notFound();
  }

  const headers = new Headers();
  headers.set('Content-Type', asset.mime);
  headers.set('Cache-Control', getCacheControl(asset.mime));
  headers.set('Content-Length', String(asset.size_bytes));

  if (asset.mime === 'text/html') {
    headers.set('Content-Security-Policy', getEmbedCSP(allowedOrigins, env));
  }

  Object.entries(getEmbedSecurityHeaders()).forEach(([k, v]) => {
    headers.set(k, v);
  });

  return new Response(obj.body, { status: 200, headers });
}

function embedPrivateNotAllowed(slug: string, env: Env): Response {
  const baseUrl = getPlatformOrigin(env);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <title>Private Content</title>
  ${googleFontsPreconnect}
  <style>${standalonePageStyles}</style>
</head>
<body>
  <div class="card">
    <h1>🔒 Private Content</h1>
    <p>This content requires authentication to view.</p>
    <a href="${baseUrl}/a/${escapeHtml(slug)}/" target="_blank">Open in new tab</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}