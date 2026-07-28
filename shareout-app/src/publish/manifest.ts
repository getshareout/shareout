/**
 * Enhanced manifest construction — classifies assets by load priority and pins
 * the SDK major + capability contract at publish time (ADR 29).
 */
import { SDK_MAJOR, CAPABILITY_CONTRACT } from '../sdk-version';
import type { AssetMetadata, AssetPriority, EnhancedManifest } from './types';

/**
 * Classify an asset for runtime preloading.
 * Root CSS and main/bundle JS are critical; large media is lazy-loaded.
 */
export function determinePriority(path: string, mime: string, size: number): AssetPriority {
  if (mime === 'text/css' && !path.includes('/')) return 'critical';
  if (mime.includes('javascript') && /main|app|bundle|index/i.test(path)) return 'critical';
  if (mime.startsWith('font/') || path.endsWith('.woff2') || path.endsWith('.woff')) return 'high';
  if (mime.startsWith('image/') && size > 102400) return 'lazy';
  if (mime.startsWith('video/')) return 'lazy';
  return 'normal';
}

/** Build manifest v2 from stored asset metadata. */
export function buildEnhancedManifest(
  entrypoint: string,
  assetMetadata: AssetMetadata[],
  mobileEntrypoint?: string | null,
): EnhancedManifest {
  const criticalCSS = assetMetadata
    .filter(a => a.priority === 'critical' && a.mime === 'text/css')
    .map(a => a.path);
  const criticalJS = assetMetadata
    .filter(a => a.priority === 'critical' && a.mime.includes('javascript'))
    .map(a => a.path);
  const criticalFonts = assetMetadata
    .filter(a => a.priority === 'high' && (a.mime.startsWith('font/') || a.path.endsWith('.woff2')))
    .map(a => a.path);

  return {
    version: 2,
    entrypoint,
    created: new Date().toISOString(),
    critical: { css: criticalCSS, js: criticalJS, fonts: criticalFonts },
    assets: assetMetadata,
    ...(mobileEntrypoint ? { mobile: { entrypoint: mobileEntrypoint } } : {}),
    sdk: { major: SDK_MAJOR, channel: 'stable' },
    capabilityContract: CAPABILITY_CONTRACT,
  };
}
