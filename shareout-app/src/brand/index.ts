import type { Env } from '../types';

export const BRAND = {
  favicon: '/brand/favicon.ico',
  favicon16: '/brand/favicon-16.png',
  favicon32: '/brand/favicon-32.png',
  appleTouchIcon: '/brand/apple-touch-icon.png',
  icon192: '/brand/icon-192.png',
  icon512: '/brand/icon-512.png',
  logoMark: '/brand/logo-mark.png',
  logoWithName: '/brand/logo-with-name.png',
  slackIcon: '/brand/slack-icon.png',
  telegramIcon: '/brand/telegram-icon.png',
  bimiLogo: '/brand/bimi-logo.svg',
} as const;

/** Standard favicon + PWA icon link tags for HTML <head>. */
export const brandFaviconHead = `<link rel="icon" href="${BRAND.favicon}" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="${BRAND.favicon32}">
<link rel="icon" type="image/png" sizes="16x16" href="${BRAND.favicon16}">
<link rel="apple-touch-icon" sizes="180x180" href="${BRAND.appleTouchIcon}">`;

export function brandMarkImg(className = 'brand-mark', size = 24): string {
  return `<img src="${BRAND.logoMark}" alt="" class="${className}" width="${size}" height="${size}" aria-hidden="true">`;
}

/** Logo mark + ShareOut wordmark using design-system typography. */
export function brandLockupHtml(options: {
  markSize?: number;
  className?: string;
  href?: string;
} = {}): string {
  const markSize = options.markSize ?? 28;
  const className = options.className ?? 'brand';
  const inner = `${brandMarkImg('brand-mark', markSize)}<span class="brand-name">ShareOut</span>`;
  if (options.href) {
    return `<a class="${className}" href="${options.href}">${inner}</a>`;
  }
  return `<span class="${className}">${inner}</span>`;
}

const BRAND_ROUTE = /^\/brand\/([^/]+)$/;
const ROOT_BRAND_FILES = new Set([
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/apple-touch-icon.png',
]);
const MIME: Record<string, string> = { '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

// Brand assets are staged as Workers Static Assets under public/_brand/ and served
// from the ASSETS binding, keeping ~343KB of base64 out of the worker bundle
// (plan §19 Phase 4). They live at /_brand/* so they don't collide with the
// worker-controlled /brand/* route.
async function serveBrandFile(filename: string, env: Env, notFound: boolean): Promise<Response | null> {
  const asset = await env.ASSETS.fetch(new URL(`/_brand/${filename}`, 'https://assets.local'));
  if (!asset.ok) return notFound ? new Response('Not Found', { status: 404 }) : null;

  const ext = filename.slice(filename.lastIndexOf('.'));
  return new Response(asset.body, {
    headers: {
      'Content-Type': MIME[ext] || asset.headers.get('Content-Type') || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

export function handleBrandAsset(path: string, env: Env): Promise<Response | null> | null {
  const match = path.match(BRAND_ROUTE);
  if (!match) return null;
  return serveBrandFile(match[1], env, true);
}

/** Also serve /favicon.ico and common root icon paths. */
export function handleRootBrandAsset(path: string, env: Env): Promise<Response | null> | null {
  if (!ROOT_BRAND_FILES.has(path)) return null;
  return serveBrandFile(path.slice(1), env, false);
}
