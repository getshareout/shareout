#!/usr/bin/env node
/**
 * Clone a public ShareOut artifact from shareout.site into your local dev worker.
 *
 * Usage:
 *   node scripts/clone-prod-artifact.mjs example-artifact --token so_... --local http://localhost:55162 --slug example-artifact-local
 *
 * Notes:
 * - This is intentionally minimal: it pulls the published HTML and the app bundle at /js/app.js?_raw.
 * - The artifact's embedded bootstrap JSON contains a baseUrl; we rewrite it to point at your local worker.
 */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

const sourceSlug = process.argv[2];
if (!sourceSlug || sourceSlug.startsWith('--')) {
  console.error('Missing source slug. Example: node scripts/clone-prod-artifact.mjs example-artifact --token so_...');
  process.exit(1);
}

const localBase = arg('--local') || process.env.SHAREOUT_LOCAL || 'http://localhost:55162';
const token = arg('--token') || process.env.SHAREOUT_TOKEN || null;
const outSlug = arg('--slug') || `${sourceSlug}-local`;

if (!token) {
  console.error('Missing token. Pass --token so_... or set SHAREOUT_TOKEN.');
  process.exit(1);
}

const sourceBase = 'https://shareout.site';
const htmlUrl = `${sourceBase}/a/${encodeURIComponent(sourceSlug)}/`;
const appUrl = `${sourceBase}/a/${encodeURIComponent(sourceSlug)}/js/app.js?_raw`;
const rawIndexUrl = `${sourceBase}/a/${encodeURIComponent(sourceSlug)}/index.html?_raw`;

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function extractRelativeAssetPaths(html) {
  const paths = [];
  // <script src="js/...">, <link href="css/...">
  const re = /\b(?:src|href)=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const p = m[1];
    if (!p) continue;
    if (p.startsWith('js/') || p.startsWith('css/')) paths.push(p);
  }
  return uniq(paths);
}

function rewriteSdkUrls(html, localBase) {
  const base = localBase.replace(/\/$/, '');
  return html
    .split('https://shareout.site/sdk/shareout.js').join(`${base}/sdk/shareout.js`)
    .split('http://shareout.site/sdk/shareout.js').join(`${base}/sdk/shareout.js`);
}

function rewriteBaseUrlInBootstrap(html, newBase) {
  // The bootstrap JSON is inside:
  // <script id="shareout-initial-data" type="application/json">{"baseUrl":"https://shareout.site",...}</script>
  const marker = 'id="shareout-initial-data"';
  const idx = html.indexOf(marker);
  if (idx === -1) return html;

  const openTagEnd = html.indexOf('>', idx);
  const closeTag = html.indexOf('</script>', openTagEnd);
  if (openTagEnd === -1 || closeTag === -1) return html;

  const jsonText = html.slice(openTagEnd + 1, closeTag);
  try {
    const parsed = JSON.parse(jsonText);
    if (typeof parsed === 'object' && parsed && typeof parsed.baseUrl === 'string') {
      parsed.baseUrl = newBase;
      const next = JSON.stringify(parsed);
      return html.slice(0, openTagEnd + 1) + next + html.slice(closeTag);
    }
  } catch {
    // ignore
  }
  return html;
}

function rewriteIframeSrc(html, sourceSlug, localBase, outSlug) {
  // Force the wrapper page to iframe the local raw HTML instead of production.
  // Prod pattern: https://shareout.site/a/<slug>/index.html?_raw
  // Local target: http://localhost:55162/a/<outSlug>/index.html?_raw
  // We publish the real raw index as "index.raw.html", and want _raw access.
  const localSrc = `${localBase.replace(/\/$/, '')}/a/${outSlug}/index.raw.html?_raw`;

  // Replace the prod iframe src (original).
  let out = html.split(`https://shareout.site/a/${sourceSlug}/index.html?_raw`).join(localSrc);

  // Also replace the local-rewritten iframe src (after rewriteAssetBaseUrls runs first).
  out = out.split(`${localBase.replace(/\/$/, '')}/a/${outSlug}/index.html?_raw`).join(localSrc);

  // Belt + suspenders: rewrite any remaining local iframe path.
  out = out.split(`/a/${outSlug}/index.html?_raw`).join(`/a/${outSlug}/index.raw.html?_raw`);

  return out;
}

function rewriteAssetBaseUrls(html, sourceSlug, localBase, outSlug) {
  const from = `https://shareout.site/a/${sourceSlug}/`;
  const to = `${localBase.replace(/\/$/, '')}/a/${outSlug}/`;
  return html.split(from).join(to);
}

console.log(`[clone] fetching ${htmlUrl}`);
let html = await fetchText(htmlUrl);
html = rewriteBaseUrlInBootstrap(html, localBase);
html = rewriteAssetBaseUrls(html, sourceSlug, localBase, outSlug);
html = rewriteIframeSrc(html, sourceSlug, localBase, outSlug);

console.log(`[clone] fetching ${rawIndexUrl}`);
let rawIndex = await fetchText(rawIndexUrl);
rawIndex = rewriteBaseUrlInBootstrap(rawIndex, localBase);
rawIndex = rewriteAssetBaseUrls(rawIndex, sourceSlug, localBase, outSlug);
rawIndex = rewriteSdkUrls(rawIndex, localBase);

const assetPaths = extractRelativeAssetPaths(rawIndex);
console.log(`[clone] found ${assetPaths.length} relative assets in raw index`);

const fetchedAssets = [];
for (const p of assetPaths) {
  const url = `${sourceBase}/a/${encodeURIComponent(sourceSlug)}/${p}${p.startsWith('js/') ? '?_raw' : ''}`;
  console.log(`[clone] fetching asset ${p}`);
  const content = await fetchText(url);
  const mime =
    p.endsWith('.css') ? 'text/css' :
    p.endsWith('.js') ? 'application/javascript' :
    'application/octet-stream';
  fetchedAssets.push({ path: p, content, mime });
}

const publishUrl = `${localBase.replace(/\/$/, '')}/v1/publish`;
console.log(`[clone] publishing to ${publishUrl} as slug ${outSlug}`);

const body = {
  name: `${sourceSlug} (local clone)`,
  slug: outSlug,
  files: [
    {
      path: 'index.html',
      // Use the "real" raw app HTML as the entrypoint for local testing/editing.
      // The wrapper page is still included as wrapper.html if needed.
      content: rawIndex,
      mime: 'text/html',
    },
    {
      path: 'wrapper.html',
      content: html,
      mime: 'text/html',
    },
    ...fetchedAssets,
  ],
};

const publishRes = await fetch(publishUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const publishText = await publishRes.text();
if (!publishRes.ok) {
  console.error(`[clone] publish failed ${publishRes.status}`);
  console.error(publishText);
  process.exit(1);
}

console.log(publishText);
console.log(`[clone] done. open: ${localBase}/a/${outSlug}/`);
console.log(`[clone] edit: ${localBase}/a/${outSlug}/edit`);

