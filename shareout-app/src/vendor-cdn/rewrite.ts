import { VENDOR_PACKAGES, vendorUrl, type VendorRef } from './registry';

/** Which packages this instance/workspace will vendor — see packages.ts. */
export type PackageFilter = (pkg: string) => boolean;

const builtInOnly: PackageFilter = pkg => VENDOR_PACKAGES.has(pkg);

/**
 * Publish-time rewrite of third-party CDN URLs to this instance's vendored copies.
 *
 * Only the URL shapes that map exactly onto an npm path are rewritten — a wrong guess
 * would 404 a library at view time, which is worse than a slow one. cdnjs is left
 * alone for that reason: its file layout does not match the npm package's.
 */

const PLOTLY_BUNDLES: Record<string, { pkg: string; file: string }> = {
  '': { pkg: 'plotly.js-dist-min', file: 'plotly.min.js' },
  basic: { pkg: 'plotly.js-basic-dist-min', file: 'plotly-basic.min.js' },
  cartesian: { pkg: 'plotly.js-cartesian-dist-min', file: 'plotly-cartesian.min.js' },
};

// plotly.com froze the `-latest` alias at 1.58.5 years ago; pin the same bytes.
const PLOTLY_LATEST = '1.58.5';

function fromPlotlyCdn(url: URL): VendorRef | null {
  const m = url.pathname.match(/^\/plotly-(?:(basic|cartesian)-)?([\w.-]+)\.min\.js$/);
  if (!m) return null;
  const bundle = PLOTLY_BUNDLES[m[1] ?? ''];
  if (!bundle) return null;
  const version = m[2] === 'latest' ? PLOTLY_LATEST : m[2];
  return { pkg: bundle.pkg, version, file: bundle.file };
}

function fromD3Org(url: URL): VendorRef | null {
  const m = url.pathname.match(/^\/d3\.v(\d+)\.min\.js$/);
  return m ? { pkg: 'd3', version: m[1], file: 'dist/d3.min.js' } : null;
}

/** jsdelivr `/npm/<pkg>@<ver>/<file>` and unpkg `/<pkg>@<ver>/<file>` are npm paths already. */
function fromNpmCdn(url: URL, stripNpmPrefix: boolean): VendorRef | null {
  const path = stripNpmPrefix
    ? url.pathname.replace(/^\/npm\//, '')
    : url.pathname.replace(/^\//, '');
  if (path === url.pathname && stripNpmPrefix) return null;
  const m = path.match(/^((?:@[^/@]+\/)?[^/@]+)@([^/]+)\/(.+)$/);
  if (!m) return null;
  return { pkg: m[1], version: m[2], file: m[3] };
}

export function mapCdnUrl(raw: string, isAllowed: PackageFilter = builtInOnly): VendorRef | null {
  let url: URL;
  try {
    url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
  } catch {
    return null;
  }
  if (url.search || url.hash) return null;

  let ref: VendorRef | null = null;
  switch (url.hostname) {
    case 'cdn.plot.ly':
      ref = fromPlotlyCdn(url);
      break;
    case 'd3js.org':
      ref = fromD3Org(url);
      break;
    case 'cdn.jsdelivr.net':
      ref = fromNpmCdn(url, true);
      break;
    case 'unpkg.com':
      ref = fromNpmCdn(url, false);
      break;
  }
  if (!ref || !isAllowed(ref.pkg)) return null;
  // Anything that isn't a plain versioned file (`+esm`, a range, a directory) stays put.
  if (!/^\d/.test(ref.version) || !/\.(?:js|mjs|css)$/.test(ref.file)) return null;
  return ref;
}

// Only quoted URLs are touched: that covers src=/href= attributes and `import('…')`
// without rewriting a CDN URL an artifact merely shows as documentation text.
const QUOTED_URL = /(["'])((?:https?:)?\/\/[^"'\s<>]+)\1/g;

export function rewriteVendorUrls(
  html: string,
  baseUrl: string,
  isAllowed: PackageFilter = builtInOnly,
): string {
  return html.replace(QUOTED_URL, (whole, quote: string, url: string) => {
    const ref = mapCdnUrl(url, isAllowed);
    return ref ? `${quote}${vendorUrl(ref, baseUrl)}${quote}` : whole;
  });
}
