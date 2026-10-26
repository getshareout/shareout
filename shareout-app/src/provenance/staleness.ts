/**
 * When a source counts as stale: the author's `freshness_sla` when declared; else twice
 * the refresh interval of its schedule (a missed run is fine, two in a row is not); else
 * twice what the declared `refresh` words imply; else a week.
 */
import { matchesField, parseCronSchedule } from '../scheduling/jobs/cron';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const DEFAULT_STALE_MS = 7 * DAY;
// Schedules are checked once an hour (wrangler cron): a due job runs at the next :00, so
// the hours a cron fires in are its runs, and nothing refreshes faster than hourly.
const MIN_INTERVAL_MS = HOUR;
const RUNS = 7;
// Room for three runs of a yearly schedule.
const HORIZON_DAYS = 800;

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

/**
 * The longest gap between consecutive runs of a 5-field cron (UTC), or null if unusable
 * or it never fires. Walks days rather than minutes, so a cron that never matches
 * (`0 0 31 2 *`) costs microseconds, not a year of minutes per run.
 */
export function cronIntervalMs(cron: string | undefined, from = Date.now()): number | null {
  if (!cron) return null;
  const key = cron.trim();
  if (intervals.has(key)) return intervals.get(key) ?? null;
  const runs = parseCronSchedule(key).valid ? runHours(key, from) : [];
  let gap = 0;
  for (let i = 1; i < runs.length; i++) gap = Math.max(gap, runs[i] - runs[i - 1]);
  // One run in the whole horizon (a leap day): rarer than the horizon itself.
  if (runs.length === 1) gap = HORIZON_DAYS * DAY;
  const out = gap > 0 ? Math.max(MIN_INTERVAL_MS, gap) : null;
  if (intervals.size > 200) intervals.clear();
  intervals.set(key, out);
  return out;
}

/** The first RUNS hours after `from` in which a valid cron fires. */
function runHours(cron: string, from: number): number[] {
  const [, hourSpec, daySpec, monthSpec, weekdaySpec] = cron.split(/\s+/);
  const mask = (spec: string, min: number, max: number) => {
    const on: boolean[] = [];
    for (let v = min; v <= max; v++) on[v] = matchesField(v, spec, min, max);
    return on;
  };
  const hours = mask(hourSpec, 0, 23).flatMap((on, h) => (on ? [h] : []));
  const days = mask(daySpec, 1, 31);
  const months = mask(monthSpec, 1, 12);
  const weekdays = mask(weekdaySpec, 0, 6);
  // Standard cron, as in getNextRunTime: when both day fields are restricted, either matches.
  const either = daySpec !== '*' && weekdaySpec !== '*';
  const start = Math.floor(from / DAY) * DAY;
  const runs: number[] = [];
  for (let d = 0; d < HORIZON_DAYS && runs.length < RUNS; d++) {
    const date = new Date(start + d * DAY);
    const byDay = days[date.getUTCDate()];
    const byWeekday = weekdays[date.getUTCDay()];
    if (!months[date.getUTCMonth() + 1] || !(either ? byDay || byWeekday : byDay && byWeekday)) continue;
    for (const h of hours) {
      const at = start + d * DAY + h * HOUR;
      if (at > from && runs.length < RUNS) runs.push(at);
    }
  }
  return runs;
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
