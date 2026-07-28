import type { PWAConfig } from '../../types';
import { colors } from '../../design-system/tokens';
import { escapeHtml } from '../utils';
import type { ParsedPwaConfig } from './types';

/** Parse stored PWA JSON config; invalid payloads are ignored. */
export function parsePwaConfig(pwaConfigJson: string | null): PWAConfig | null {
  if (!pwaConfigJson) return null;
  try {
    return JSON.parse(pwaConfigJson) as PWAConfig;
  } catch {
    return null;
  }
}

/** Render PWA install/meta tags when progressive web app mode is enabled. */
export function renderPwaMetaTags(
  pwaConfig: PWAConfig | null,
  baseUrl: string,
  slug: string,
): string {
  if (!pwaConfig?.enabled) return '';

  const themeColor = pwaConfig.theme_color || colors.primary;
  const appName = escapeHtml(pwaConfig.name || slug);

  return `
  <link rel="manifest" href="${baseUrl}/a/${slug}/manifest.json">
  <meta name="theme-color" content="${themeColor}">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="${appName}">
  <link rel="apple-touch-icon" href="${baseUrl}/a/${slug}/_pwa/icon-192.png">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="application-name" content="${appName}">
  <meta name="msapplication-TileColor" content="${themeColor}">
  <meta name="msapplication-TileImage" content="${baseUrl}/a/${slug}/_pwa/icon-144.png">`;
}

/** Convenience helper used by the viewer entrypoint. */
export function resolvePwa(pwaConfigJson: string | null, baseUrl: string, slug: string): ParsedPwaConfig {
  const config = parsePwaConfig(pwaConfigJson);
  return {
    config,
    tags: renderPwaMetaTags(config, baseUrl, slug),
  };
}
