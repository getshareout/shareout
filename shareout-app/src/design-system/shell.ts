/**
 * ShareOut Design System - HTML page shell
 * Wraps server-rendered pages with shared base styles and fonts
 */

import { baseStyles } from './base.css';
import { componentStylesheet, componentScripts } from './components/index';
import { googleFontsPreconnect } from './tokens';
import { brandFaviconHead } from '../brand';

export interface HtmlPageOptions {
  title: string;
  description?: string;
  pageStyles: string;
  body: string;
  bodyClass?: string;
  scripts?: string;
  lang?: string;
  cacheControl?: string;
  extraHead?: string;
  /** Extra response headers (e.g. X-Robots-Tag for private gates). */
  extraHeaders?: Record<string, string>;
  /** Self-referencing canonical URL — consolidates www/apex/CDN-subdomain duplicates. */
  canonical?: string;
  /** One or more schema.org JSON-LD objects (serialized) injected as <script type="application/ld+json">. */
  jsonLd?: string | string[];
  status?: number;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogUrl?: string;
  ogType?: string;
  twitterCard?: 'summary' | 'summary_large_image';
  /** Skip Open Graph / Twitter tags entirely (private access gates). */
  noSocial?: boolean;
}

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Baseline security headers for server-rendered shell pages (marketing + app).
// Conservative set — no CSP (these pages mix inline styles/scripts and the
// platform serves user HTML elsewhere); just the safe, high-value headers.
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function buildSocial(options: Omit<HtmlPageOptions, 'body' | 'scripts'>): string {
  if (options.noSocial) return '';
  const { title, description, ogTitle, ogDescription, ogImage, ogUrl, ogType = 'website', twitterCard } = options;
  const socialTitle = ogTitle ?? title;
  const socialDescription = ogDescription ?? description;
  const card = twitterCard ?? (ogImage ? 'summary_large_image' : 'summary');
  return [
    `<meta property="og:type" content="${attr(ogType)}">`,
    `<meta property="og:title" content="${attr(socialTitle)}">`,
    socialDescription ? `<meta property="og:description" content="${attr(socialDescription)}">` : '',
    ogUrl ? `<meta property="og:url" content="${attr(ogUrl)}">` : '',
    ogImage ? `<meta property="og:image" content="${attr(ogImage)}">` : '',
    `<meta name="twitter:card" content="${card}">`,
    `<meta name="twitter:title" content="${attr(socialTitle)}">`,
    socialDescription ? `<meta name="twitter:description" content="${attr(socialDescription)}">` : '',
    ogImage ? `<meta name="twitter:image" content="${attr(ogImage)}">` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderHtmlPage(options: HtmlPageOptions): Response {
  const { body, scripts = '', cacheControl = 'no-cache', status = 200, extraHeaders } = options;
  const social = buildSocial(options);

  const html = `${renderHeadAndBodyOpen(options, social)}
${body}
<script>${componentScripts}</script>
${scripts ? `<script>${scripts}</script>` : ''}
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': cacheControl,
      ...SECURITY_HEADERS,
      ...(extraHeaders || {}),
    },
  });
}

/** Everything from <!DOCTYPE> through the opening <body> tag — shared by the
 *  buffered and streamed renderers so the head never diverges. */
function renderHeadAndBodyOpen(options: Omit<HtmlPageOptions, 'body' | 'scripts'>, social: string): string {
  const {
    title, description, pageStyles, bodyClass, lang = 'en', extraHead = '', canonical, jsonLd,
  } = options;
  const jsonLdTags = (jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [])
    .map((block) => `<script type="application/ld+json">${block.replace(/</g, '\\u003c')}</script>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
${description ? `<meta name="description" content="${description}">` : ''}
${canonical ? `<link rel="canonical" href="${attr(canonical)}">` : ''}
${social}
${jsonLdTags}
${brandFaviconHead}
${googleFontsPreconnect}
<style>
${baseStyles}
${componentStylesheet()}
${pageStyles}
</style>
${extraHead}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>`;
}

export interface StreamedHtmlPageOptions extends Omit<HtmlPageOptions, 'body' | 'scripts'> {
  /** Streamed immediately after <body> (before the body producer runs) — e.g. a loading overlay. */
  earlyBody?: string;
  /** Produces the real body + scripts; runs after the head has already been flushed. */
  body: () => Promise<{ body: string; scripts?: string }>;
}

/**
 * Like renderHtmlPage, but streams the <head> and `earlyBody` immediately, then
 * runs `body()` and streams the result. Lets a page paint a skeleton/cached shell
 * at first byte while its data loads. The head is identical to renderHtmlPage.
 */
export function renderHtmlPageStreamed(options: StreamedHtmlPageOptions): Response {
  const { status = 200, cacheControl = 'no-cache', earlyBody = '' } = options;
  const social = buildSocial(options);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  writer.write(enc.encode(`${renderHeadAndBodyOpen(options, social)}\n${earlyBody}\n`));

  (async () => {
    try {
      const { body, scripts = '' } = await options.body();
      await writer.write(enc.encode(`${body}
<script>${componentScripts}</script>
${scripts ? `<script>${scripts}</script>` : ''}
</body>
</html>`));
    } catch {
      await writer.write(enc.encode(`<div style="padding:2rem;font-family:system-ui">Something went wrong loading this page. <a href="/home">Reload</a>.</div>
</body>
</html>`));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': cacheControl,
      'Transfer-Encoding': 'chunked',
      ...SECURITY_HEADERS,
    },
  });
}
