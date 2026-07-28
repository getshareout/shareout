import { googleFontsPreconnect, standalonePageStyles } from '../design-system/standalone-page';

// Mobile device detection regex
const MOBILE_UA_REGEX = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

export function isMobileDevice(request: Request): boolean {
  const ua = request.headers.get('User-Agent') || '';
  return MOBILE_UA_REGEX.test(ua);
}

// Social / search crawlers (link unfurlers + indexers). Kept for diagnostics and
// public-artifact tooling. Private/workspace serve paths must NOT special-case these
// UAs — doing so used to leak title/description/thumbnails to Googlebot without auth.
const SOCIAL_CRAWLER_UA_REGEX =
  /facebookexternalhit|Facebot|Twitterbot|Slackbot|Discordbot|LinkedInBot|WhatsApp|TelegramBot|Pinterest|redditbot|Google-PageRenderer|Googlebot|bingbot|Applebot|SkypeUriPreview|vkShare|W3C_Validator|iframely|embedly/i;

export function isSocialCrawler(request: Request): boolean {
  const ua = request.headers.get('User-Agent') || '';
  return SOCIAL_CRAWLER_UA_REGEX.test(ua);
}

/** Response header value: keep closed content out of search indexes. */
export const NOINDEX_ROBOTS = 'noindex, nofollow, noarchive';

export function extractTextFromHtml(html: string): string {
  let text = html;

  // Remove script and style blocks entirely
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Replace common block elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n');
  text = text.replace(/<(br|hr)[^>]*\/?>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));

  // Normalize whitespace: collapse multiple spaces/newlines
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  text = text.trim();

  return text;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Register fire-and-forget background work (analytics, view events) with the Worker
// runtime so it isn't cancelled when the response finishes. Falls back to a detached
// promise when no ExecutionContext is available (e.g. tests). Errors are swallowed —
// background telemetry must never break serving.
export function runBackground(
  executionCtx: ExecutionContext | undefined,
  task: Promise<unknown>,
): void {
  const safe = task.catch(() => {});
  if (executionCtx) {
    executionCtx.waitUntil(safe);
  } else {
    void safe;
  }
}

export function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export function pausedPage(_artifactName?: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="${NOINDEX_ROBOTS}">
  <title>Paused</title>
  ${googleFontsPreconnect}
  <style>
    ${standalonePageStyles}
    .icon { font-size: 3rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⏸️</div>
    <h1>This content is paused</h1>
    <p>This content is temporarily unavailable.</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 503,
    headers: { 'Content-Type': 'text/html', 'X-Robots-Tag': NOINDEX_ROBOTS },
  });
}

/** Shown when an artifact was blocked by safety review (Workstream B). Distinct
 *  copy from pausedPage so a takedown reads as a takedown, not a temporary pause. */
export function takedownPage(_artifactName?: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="${NOINDEX_ROBOTS}">
  <title>Unavailable</title>
  ${googleFontsPreconnect}
  <style>
    ${standalonePageStyles}
    .icon { font-size: 3rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🚫</div>
    <h1>This page is unavailable</h1>
    <p>This page was removed by ShareOut safety review.</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 451,
    headers: { 'Content-Type': 'text/html', 'X-Robots-Tag': NOINDEX_ROBOTS },
  });
}

/** Shown to an anonymous/unauthorized visitor of a page that was held private by
 *  the publish-time safety check while it was published public (Workstream C). The
 *  owner still sees the real page — this replaces the misleading login wall for
 *  everyone else. 503 + Retry-After mirrors pausedPage's "temporarily unavailable"
 *  semantics; the hold self-heals within the hour (see MODERATION_PENDING_MESSAGE). */
export function underReviewPage(_artifactName?: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="${NOINDEX_ROBOTS}">
  <title>Being reviewed</title>
  ${googleFontsPreconnect}
  <style>
    ${standalonePageStyles}
    .icon { font-size: 3rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔍</div>
    <h1>This page is being reviewed</h1>
    <p>This page is going through an automated safety review. It usually clears within the hour — check back soon.</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 503,
    headers: { 'Content-Type': 'text/html', 'Retry-After': '3600', 'X-Robots-Tag': NOINDEX_ROBOTS },
  });
}
