/**
 * Cron schedule parsing and next-run computation (UTC).
 *
 * Schedules are stored as 5-field cron strings and interpreted in UTC to match
 * Cloudflare cron triggers and keep dev/test results timezone-independent.
 */

/**
 * Parse one cron segment (no commas) into an inclusive range + step, or null if
 * malformed / out of bounds. Handles `*`, `a`, `a-b`, `*​/s`, `a/s`, `a-b/s`.
 */
function parseSegment(
  segment: string,
  min: number,
  max: number
): { start: number; end: number; step: number } | null {
  let range = segment;
  let step = 1;
  if (segment.includes('/')) {
    const idx = segment.indexOf('/');
    range = segment.slice(0, idx);
    step = parseInt(segment.slice(idx + 1), 10);
    if (isNaN(step) || step < 1) return null;
  }

  let start: number;
  let end: number;
  if (range === '*') {
    start = min;
    end = max;
  } else if (range.includes('-')) {
    const [a, b] = range.split('-');
    start = parseInt(a, 10);
    end = parseInt(b, 10);
    if (isNaN(start) || isNaN(end)) return null;
  } else {
    start = parseInt(range, 10);
    if (isNaN(start)) return null;
    // `a/s` (single value + step) runs from a up to max; `a` alone is just a.
    end = segment.includes('/') ? max : start;
  }

  if (start < min || end > max || start > end) return null;
  return { start, end, step };
}

/** Does `value` satisfy a full cron field (comma-separated segments, OR'd)? */
function matchesField(value: number, spec: string, min: number, max: number): boolean {
  return spec.split(',').some(seg => {
    const p = parseSegment(seg, min, max);
    return p !== null && value >= p.start && value <= p.end && (value - p.start) % p.step === 0;
  });
}

/** Validate a 5-field cron expression (minute hour day month weekday). */
export function parseCronSchedule(cron: string): { valid: boolean; error?: string } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { valid: false, error: 'Cron must have 5 fields: minute hour day month weekday' };
  }

  const [minute, hour, day, month, weekday] = parts;
  const fields = [
    { name: 'minute', min: 0, max: 59, value: minute },
    { name: 'hour', min: 0, max: 23, value: hour },
    { name: 'day', min: 1, max: 31, value: day },
    { name: 'month', min: 1, max: 12, value: month },
    { name: 'weekday', min: 0, max: 6, value: weekday },
  ];

  for (const { name, min, max, value } of fields) {
    for (const seg of value.split(',')) {
      if (parseSegment(seg, min, max) !== null) continue;
      if (seg.includes('/')) return { valid: false, error: `Invalid step in ${name}: ${value}` };
      if (seg.includes('-')) return { valid: false, error: `Invalid range in ${name}: ${value}` };
      if (value.includes(',')) return { valid: false, error: `Invalid value in ${name}: ${seg}` };
      return { valid: false, error: `Invalid ${name}: ${value} (must be ${min}-${max})` };
    }
  }

  return { valid: true };
}

/** ISO-8601 UTC instant of the next cron match on or after `from`. Matches the
 *  `*_at` storage convention: TEXT, `YYYY-MM-DDTHH:MM:SS.sssZ`. */
export function getNextRunTime(cron: string, from: Date = new Date()): string {
  const parts = cron.trim().split(/\s+/);
  const [minuteSpec, hourSpec, daySpec, monthSpec, weekdaySpec] = parts;

  // Standard cron: when BOTH day-of-month and day-of-week are restricted, a day
  // matches if EITHER matches (OR). If either is '*', they intersect (AND).
  const domRestricted = daySpec !== '*';
  const dowRestricted = weekdaySpec !== '*';

  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);

  for (let i = 0; i < 525600; i++) {
    const minute = next.getUTCMinutes();
    const hour = next.getUTCHours();
    const day = next.getUTCDate();
    const month = next.getUTCMonth() + 1;
    const weekday = next.getUTCDay();

    const domMatch = matchesField(day, daySpec, 1, 31);
    const dowMatch = matchesField(weekday, weekdaySpec, 0, 6);
    const dayMatch = domRestricted && dowRestricted ? domMatch || dowMatch : domMatch && dowMatch;

    if (
      matchesField(minute, minuteSpec, 0, 59) &&
      matchesField(hour, hourSpec, 0, 23) &&
      matchesField(month, monthSpec, 1, 12) &&
      dayMatch
    ) {
      return next.toISOString();
    }

    next.setUTCMinutes(next.getUTCMinutes() + 1);
  }

  return new Date(Date.now() + 86400 * 1000).toISOString();
}
