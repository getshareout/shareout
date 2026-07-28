import type { Env } from '../types';
import { recordRequestMetric, recordError, type ErrorEvent } from './store';
import { alertOnError } from './alerts';

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

// Fire-and-forget telemetry for one completed request. Always folds the request
// into its hour bucket; on a server error (5xx / exception) also logs it and
// raises a throttled Telegram alert. Never blocks or throws into the request.
export function observe(env: Env, ctx: ExecutionContext | undefined, evt: ObserveEvent): void {
  if (shouldSkipObservability(evt)) return;

  const run = async () => {
    await recordRequestMetric(env, {
      status: evt.status,
      durationMs: evt.durationMs,
      outcome: evt.outcome,
    }).catch(() => {});

    if (evt.status >= 500 || evt.outcome === 'exception') {
      const errEvt: ErrorEvent = {
        ...evt,
        outcome: evt.outcome === 'exception' ? 'exception' : 'http_error',
      };
      await recordError(env, errEvt).catch(() => {});
      await alertOnError(env, errEvt).catch(() => {});
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
  runHealthSweep,
  sendDailySummary,
  sendWorkspaceCostDigest,
  notifyAdmin,
} from './alerts';
export {
  notifySuperadmins,
  resolveSuperadminTelegramChatIds,
  SUPERADMIN_RECIPIENTS,
  SUPERADMIN_EMAILS,
} from '../superadmin/recipients';
