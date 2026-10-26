/**
 * When a source counts as stale: the author's `freshness_sla` when declared; else twice
 * the refresh interval of its schedule (a missed run is fine, two in a row is not); else
 * twice what the declared `refresh` words imply; else a week.
 */
import { getNextRunTime, parseCronSchedule } from '../scheduling/jobs/cron';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const DEFAULT_STALE_MS = 7 * DAY;
// Schedules are checked once an hour (wrangler cron), so nothing refreshes faster.
const MIN_INTERVAL_MS = HOUR;
const RUNS = 7;
const HORIZON_MS = 62 * DAY;

/** `24h`, `90m`, `2d`, `1w` or ISO 8601 (`PT6H`, `P1D`, `P1DT12H`, `P2W`) → ms. */
export function parseDuration(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  const plain = s.match(/^(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)$/i);
  if (plain) {
    const n = Number(plain[1]);
    const unit = plain[2].toLowerCase()[0];
    const ms = n * (unit === 'm' ? MINUTE : unit === 'h' ? HOUR : unit === 'd' ? DAY : 7 * DAY);
    return ms > 0 ? ms : null;
  }
  const iso = s.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i);
  if (iso && s.length > 1 && !/T$/i.test(s)) {
    const [, w, d, h, m] = iso.map((v) => Number(v || 0));
    const ms = w * 7 * DAY + d * DAY + h * HOUR + m * MINUTE;
    return ms > 0 ? ms : null;
  }
  return null;
}

const intervals = new Map<string, number | null>();

/** The longest gap between consecutive runs of a 5-field cron (UTC), or null if unusable. */
export function cronIntervalMs(cron: string | undefined, from = Date.now()): number | null {
  if (!cron) return null;
  const key = cron.trim();
  if (intervals.has(key)) return intervals.get(key) ?? null;
  let out: number | null = null;
  if (parseCronSchedule(key).valid) {
    const runs: number[] = [];
    let at = new Date(from);
    for (let i = 0; i < RUNS; i++) {
      const next = Date.parse(getNextRunTime(key, at));
      if (Number.isNaN(next) || next - from > HORIZON_MS) break;
      runs.push(next);
      at = new Date(next);
    }
    let gap = 0;
    for (let i = 1; i < runs.length; i++) gap = Math.max(gap, runs[i] - runs[i - 1]);
    // A single run inside the horizon (monthly and sparser): the horizon is the gap.
    if (runs.length === 1) gap = HORIZON_MS / 2;
    out = gap > 0 ? Math.max(MIN_INTERVAL_MS, gap) : null;
  }
  if (intervals.size > 200) intervals.clear();
  intervals.set(key, out);
  return out;
}

/** What a declared cadence in words implies ("daily 12:00 UTC", "cada hora", "semanal"). */
export function refreshWordsIntervalMs(text: string | undefined): number | null {
  const s = (text || '').toLowerCase();
  if (!s) return null;
  if (/\b(hourly|every hour|cada hora)\b/.test(s)) return HOUR;
  if (/\b(daily|every day|diari[oa]|todos los d[ií]as|cada d[ií]a)\b/.test(s)) return DAY;
  if (/\b(weekdays|de lunes a viernes)\b/.test(s)) return 3 * DAY;
  if (/\b(weekly|every week|semanal|cada semana)\b/.test(s)) return 7 * DAY;
  if (/\b(monthly|every month|mensual|cada mes)\b/.test(s)) return 31 * DAY;
  return null;
}

export interface StaleRule {
  sla?: string;
  schedules: Array<string | undefined>;
  refresh?: string;
}

export function staleAfterMs(rule: StaleRule, from = Date.now()): number {
  const sla = parseDuration(rule.sla);
  if (sla) return sla;
  const scheduled = rule.schedules
    .map((c) => cronIntervalMs(c, from))
    .filter((v): v is number => v !== null);
  if (scheduled.length) return 2 * Math.min(...scheduled);
  const words = refreshWordsIntervalMs(rule.refresh);
  if (words) return 2 * words;
  return DEFAULT_STALE_MS;
}
