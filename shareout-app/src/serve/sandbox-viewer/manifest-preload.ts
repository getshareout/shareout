import type { Env } from '../../types';
import { escapeHtml } from '../utils';
import type { EnhancedManifest } from '../types';
import type { ManifestPreloadResult } from './types';

// Long TTL: the result is a pure function of the (immutable) version — a new
// publish gets a new version_id, hence a new key, so no invalidation is needed.
const MANIFEST_PRELOAD_TTL = 24 * 60 * 60; // 24h
const MANIFEST_PRELOAD_MAX_BYTES = 100 * 1024;

/**
 * Resolve manifest v2 critical assets: inline up to three critical CSS files
 * and emit `<link rel="preload">` tags for remaining CSS, JS, and fonts.
 *
 * The result (inlined CSS + preload links) is immutable per version, so it is
 * cached in KV keyed by version_id to remove the per-view D1 + R2 reads.
 */
export async function resolveManifestPreload(
  env: Env,
  versionId: string,
  slug: string,
  baseUrl: string,
  manifestJson: string | null,
): Promise<ManifestPreloadResult> {
  const cacheKey = `mpre:${versionId}`;
  if (env.SLUGS) {
    try {
      const cached = await env.SLUGS.get<ManifestPreloadResult>(cacheKey, 'json');
      if (cached) return cached;
    } catch {}
  }

  const result = await computeManifestPreload(env, versionId, slug, baseUrl, manifestJson);

  if (env.SLUGS) {
    try {
      const serialized = JSON.stringify(result);
      if (serialized.length <= MANIFEST_PRELOAD_MAX_BYTES) {
        await env.SLUGS.put(cacheKey, serialized, { expirationTtl: MANIFEST_PRELOAD_TTL });
      }
    } catch {}
  }

  return result;
}

async function computeManifestPreload(
  env: Env,
  versionId: string,
  slug: string,
  baseUrl: string,
  manifestJson: string | null,
): Promise<ManifestPreloadResult> {
  let manifest: EnhancedManifest | null = null;
  if (manifestJson) {
    try {
      const parsed = JSON.parse(manifestJson);
      if (parsed.version === 2) {
        manifest = parsed as EnhancedManifest;
      }
    } catch {
      // Fall through to legacy asset discovery.
    }
  }

  if (manifest) {
    return resolveFromManifest(env, versionId, slug, baseUrl, manifest);
  }

  return resolveLegacyPreloads(env, versionId, slug, baseUrl);
}

async function resolveFromManifest(
  env: Env,
  versionId: string,
  slug: string,
  baseUrl: string,
  manifest: EnhancedManifest,
): Promise<ManifestPreloadResult> {
  const inlineableCSSPaths = manifest.assets
    .filter(a => a.mime === 'text/css' && a.inlineable && a.priority === 'critical')
    .map(a => a.path);

  let inlinedCSS = '';
  if (inlineableCSSPaths.length > 0) {
    const cssContents = await Promise.all(
      inlineableCSSPaths.slice(0, 3).map(async (path) => {
        const asset = await env.DB.prepare(
          'SELECT r2_key FROM assets WHERE version_id = ? AND path = ?',
        ).bind(versionId, path).first<{ r2_key: string }>();
        if (!asset) return '';
        const obj = await env.ARTIFACTS.get(asset.r2_key);
        return obj ? await obj.text() : '';
      }),
    );
    inlinedCSS = cssContents.filter(Boolean).join('\n');
  }

  const preloadAssets: Array<{ path: string; type: string }> = [];

  for (const path of manifest.critical.css) {
    if (!inlineableCSSPaths.includes(path)) {
      preloadAssets.push({ path, type: 'style' });
    }
  }

  for (const path of manifest.critical.js) {
    preloadAssets.push({ path, type: 'script' });
  }

  for (const path of manifest.critical.fonts.slice(0, 4)) {
    preloadAssets.push({ path, type: 'font' });
  }

  const preloadLinks = preloadAssets.map(({ path, type }) => {
    const crossorigin = type === 'font' ? ' crossorigin' : '';
    return `<link rel="preload" href="${baseUrl}/a/${slug}/${escapeHtml(path)}?_raw" as="${type}"${crossorigin}>`;
  }).join('\n  ');

  return { inlinedCSS, preloadLinks };
}

async function resolveLegacyPreloads(
  env: Env,
  versionId: string,
  slug: string,
  baseUrl: string,
): Promise<ManifestPreloadResult> {
  const criticalAssets = await env.DB.prepare(`
    SELECT path, mime FROM assets
    WHERE version_id = ?
    AND (mime LIKE 'text/css%' OR mime LIKE '%javascript%' OR mime LIKE 'font/%' OR path LIKE '%.woff2')
    LIMIT 10
  `).bind(versionId).all<{ path: string; mime: string }>();

  const preloadLinks = (criticalAssets.results || []).map(asset => {
    const asType = asset.mime.includes('css') ? 'style'
      : asset.mime.includes('javascript') ? 'script'
        : (asset.mime.startsWith('font/') || asset.path.endsWith('.woff2')) ? 'font' : null;
    if (!asType) return '';
    const crossorigin = asType === 'font' ? ' crossorigin' : '';
    return `<link rel="preload" href="${baseUrl}/a/${slug}/${escapeHtml(asset.path)}?_raw" as="${asType}"${crossorigin}>`;
  }).filter(Boolean).join('\n  ');

  return { inlinedCSS: '', preloadLinks };
}

/** Wrap inlined critical CSS for injection into the streamed head. */
export function renderInlinedStyleBlock(inlinedCSS: string): string {
  return inlinedCSS
    ? `<style id="inlined-critical">${inlinedCSS}</style>\n  `
    : '';
}
