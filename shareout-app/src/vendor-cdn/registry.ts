/**
 * Vendored library CDN — this instance serves the JS libraries artifacts actually use
 * (Plotly, D3, Chart.js…) from its own origin instead of sending every viewer out to a
 * third-party CDN.
 *
 * Why: a chart library is the heaviest thing a data artifact loads (plotly.js-dist-min
 * is ~1.3MB brotli) and loading it from cdn.plot.ly costs a third DNS + TLS handshake
 * on the critical path, is uncacheable by our edge, and trips the publish-time
 * moderation classifier that forces CDN-script artifacts private. Pulled once from
 * jsdelivr and frozen in R2, the same bytes are served immutable + edge-cached from a
 * host the viewer is already connected to.
 *
 * The allowlist is the security boundary: only these packages are ever fetched, so the
 * route can never be used as a general-purpose proxy.
 */

/** npm packages this instance will vendor. Everything else 404s. */
export const VENDOR_PACKAGES: ReadonlySet<string> = new Set([
  // charting / dataviz — the reason this exists
  'plotly.js-dist-min',
  'plotly.js-basic-dist-min',
  'plotly.js-cartesian-dist-min',
  'd3',
  'chart.js',
  'chartjs-adapter-date-fns',
  'echarts',
  'apexcharts',
  'mermaid',
  // data wrangling / formatting
  'lodash',
  'dayjs',
  'date-fns',
  'luxon',
  'papaparse',
  'numeral',
  // content / rendering
  'marked',
  'dompurify',
  'katex',
  'highlight.js',
  // UI / app
  'alpinejs',
  'htmx.org',
  'preact',
  'react',
  'react-dom',
  'vue',
  'leaflet',
  'three',
  'gsap',
  'zod',
]);

export const VENDOR_PREFIX = '/vendor/';

const UPSTREAM_ORIGIN = 'https://cdn.jsdelivr.net/npm';

/** A vendored file: npm package, the version string as written, and the file inside it. */
export interface VendorRef {
  pkg: string;
  version: string;
  file: string;
}

// Loose versions ("7", "2.35") are allowed and resolve upstream once; the bytes we
// store are then frozen under that exact string, so a pinned URL never drifts after
// its first fetch.
const VERSION_RE = /^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/;
const FILE_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.(?:js|mjs|css)$/;

/** `/vendor/<pkg>@<version>/<file>` → ref, or null when it is not a servable path. */
export function parseVendorPath(path: string): VendorRef | null {
  if (!path.startsWith(VENDOR_PREFIX)) return null;
  const rest = path.slice(VENDOR_PREFIX.length);
  const m = rest.match(/^((?:@[^/@]+\/)?[^/@]+)@([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, pkg, version, file] = m;
  if (!VENDOR_PACKAGES.has(pkg)) return null;
  if (!VERSION_RE.test(version)) return null;
  if (file.includes('..') || !FILE_RE.test(file)) return null;
  return { pkg, version, file };
}

export function vendorPath(ref: VendorRef): string {
  return `${VENDOR_PREFIX}${ref.pkg}@${ref.version}/${ref.file}`;
}

/** Absolute URL on this instance — what a published artifact references. */
export function vendorUrl(ref: VendorRef, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}${vendorPath(ref)}`;
}

export function upstreamUrl(ref: VendorRef): string {
  return `${UPSTREAM_ORIGIN}/${ref.pkg}@${ref.version}/${ref.file}`;
}

/** R2 key. `vendor/` can never collide with an artifact key (those start `art_`). */
export function vendorR2Key(ref: VendorRef): string {
  return `vendor/${ref.pkg}@${ref.version}/${ref.file}`;
}

export function vendorMime(file: string): string {
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/javascript; charset=utf-8';
}
