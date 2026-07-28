import { LOADING_STYLES, LOADING_MARKUP } from './loading';
import { brandFaviconHead } from '../../brand';

/**
 * Streamed first chunk: doctype, head, iframe shell styles, and the branded
 * loading skeleton. Opens <body> and paints the skeleton immediately (before any
 * per-view D1/KV work) so the viewer shows content-shaped feedback in ~first paint
 * instead of blank white. The rest of the body (iframe, data, toolbar) streams
 * after prefetch; the skeleton is removed on `shareout:content-ready`.
 */
export function renderEarlyHead(
  escapedPageTitle: string,
  socialTags: string,
  pwaTags: string,
  // On the content domain the artifact loads cross-origin; warming the TLS
  // connection in the very first streamed byte shaves the handshake off the
  // iframe's critical path.
  preconnectHost?: string,
  // Closed (private/workspace) pages must not be indexed even when a logged-in
  // viewer (or a cached session) receives the real document.
  noindex = false,
): string {
  const preconnect = preconnectHost
    ? `<link rel="preconnect" href="https://${preconnectHost}">\n  `
    : '';
  // Authorized private viewers still get a real browser title. Social/OG tags stay
  // off for closed pages so scrapers of the HTML can't unfurl private metadata; the
  // unauthorized path never reaches this wrapper.
  const robots = noindex
    ? `<meta name="robots" content="noindex, nofollow, noarchive">\n  `
    : '';
  const metaSocial = noindex ? '' : socialTags;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${escapedPageTitle} | ShareOut</title>
  ${robots}${preconnect}${brandFaviconHead}${metaSocial}${pwaTags}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; }${LOADING_STYLES}
  </style>
</head>
<body>
  ${LOADING_MARKUP}
`;
}
