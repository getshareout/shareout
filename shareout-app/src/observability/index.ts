import type { Env } from '../types';
import { recordRequestMetric, recordError, type ErrorEvent } from './store';

export interface ObserveEvent {
  status: number;
  durationMs: number;
  outcome: 'success' | 'http_error' | 'exception';
  method?: string;
  route?: string;
  path?: string;
  hostname?: string;
  isLocal?: boolean;
  requestId?: string;
  message?: string;
  country?: string;
}

function normalizeHostname(hostname?: string): string {
  const raw = (hostname || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(1, end) : raw;
  }
  if (/^[a-z0-9.-]+:\d+$/.test(raw)) {
    return raw.slice(0, raw.lastIndexOf(':'));
  }
  return raw;
}

function isLocalHostname(hostname?: string): boolean {
  const host = normalizeHostname(hostname);
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1'
  );
}

export function shouldSkipObservability(evt: Pick<ObserveEvent, 'hostname' | 'isLocal' | 'path'>): boolean {
  return Boolean(
    evt.isLocal ||
    isLocalHostname(evt.hostname) ||
    evt.path === '/auth/dev'
  );
}

// Left out of the hourly request metric: CORS preflights, static bytes and telemetry
// beacons. Each counted request is an upsert on the single-writer D1 primary, and these
// fire on every page load or on a timer. A failed one (5xx / exception) still counts and
// is logged. The paths mirror the router's static and beacon routes:
//   /sdk/ /lib/ /vendor/              shared bundles: SDK, editor and home-shell bundles,
//                                     Workspace Library modules, vendored libraries
//                                     (router/shared-bundles.ts)
//   /brand/, root icons               brand images (brand/index.ts)
//   /t/ /wl/                          artifact thumbnails, workspace logos (router/serve-router.ts)
//   /manifest.webmanifest /sw.js      app-shell files (router/serve-router.ts)
//   /v1/perf /v1/presence /v1/funnel  always-204 beacons (router/api/{perf,presence,funnel}.ts)
const UNCOUNTED_PREFIXES = ['/sdk/', '/lib/', '/vendor/', '/brand/', '/t/', '/wl/'];
const UNCOUNTED_PATHS = new Set([
  '/favicon.ico', '/favicon-16.png', '/favicon-32.png', '/apple-touch-icon.png',
  '/manifest.webmanifest', '/sw.js',
  '/v1/perf', '/v1/presence', '/v1/funnel',
]);

/** False for requests the hourly request metric leaves out (see above). */
export function countsInRequestMetrics(evt: Pick<ObserveEvent, 'method' | 'path'>): boolean {
  if (evt.method === 'OPTIONS') return false;
  const path = evt.path ?? '';
  return !UNCOUNTED_PATHS.has(path) && !UNCOUNTED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// Fire-and-forget telemetry for one completed request. Folds the request into its
// hour bucket unless countsInRequestMetrics leaves it out; a server error (5xx /
// exception) always folds and is also logged. Never blocks or throws into the request.
export function observe(env: Env, ctx: ExecutionContext | undefined, evt: ObserveEvent): void {
  if (shouldSkipObservability(evt)) return;
  const serverError = evt.status >= 500 || evt.outcome === 'exception';
  if (!serverError && !countsInRequestMetrics(evt)) return;

  const run = async () => {
    await recordRequestMetric(env, {
      status: evt.status,
      durationMs: evt.durationMs,
      outcome: evt.outcome,
    }).catch(() => {});

    if (serverError) {
      const errEvt: ErrorEvent = {
        ...evt,
        outcome: evt.outcome === 'exception' ? 'exception' : 'http_error',
      };
      await recordError(env, errEvt).catch(() => {});
    }
  };

  if (ctx?.waitUntil) ctx.waitUntil(run());
  else void run();
}

export {
  getHourlySeries,
  getWindowSummary,
  getRecentErrors,
  cleanupObservability,
  type HourRow,
  type WindowSummary,
  type ErrorRow,
} from './store';
export {
  SUPERADMIN_RECIPIENTS,
  SUPERADMIN_EMAILS,
} from '../superadmin/recipients';
