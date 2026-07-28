/**
 * The timestamp convention, enforced against the *source* rather than the schema.
 *
 * `schema-timestamps.test.ts` pins 0000_init.sql. This pins the other half: what the
 * application writes. PR-2 converted 375 `datetime('now')` call sites and declared the
 * job done — but SQLite treats an unknown double-quoted identifier as a string literal,
 * so `datetime("now")` runs fine, writes the space-separated form that JavaScript reads
 * as LOCAL time, and slipped past a grep for the single-quoted spelling. Twenty-one of
 * them survived four more phases.
 *
 * See migrations/CONVENTIONS.md § "Timestamps: one type, one format, one vocabulary".
 */
import { describe, expect, it } from 'vitest';
// Vite inlines these at build time — the workers pool has no filesystem.
const sources = import.meta.glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Every spelling of the banned call, in either quoting style. */
const BANNED = [/datetime\(\s*'now'/, /datetime\(\s*"now"/, /\bunixepoch\s*\(/];

function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const [path, text] of Object.entries(sources)) {
    for (const [i, line] of text.split('\n').entries()) {
      if (pattern.test(line)) hits.push(`${path.replace('../../', '')}:${i + 1}`);
    }
  }
  return hits;
}

describe('source timestamp convention', () => {
  it('reads the source tree (guards against a glob that matches nothing)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(200);
    expect(Object.values(sources).join('').length).toBeGreaterThan(100_000);
  });

  it.each([
    ["datetime('now')", BANNED[0]],
    ['datetime("now") — the double-quoted disguise that survived PR-2', BANNED[1]],
  ])('never calls %s', (_label, pattern) => {
    expect(offenders(pattern)).toEqual([]);
  });

  it('uses unixepoch() only against the documented scheduler-cursor columns', () => {
    // The cursors (next_run_at, last_run_at, job_runs.created_at) hold unix seconds by
    // design — see CONVENTIONS.md. Anywhere else, unixepoch is comparing against an ISO
    // column and the comparison is wrong.
    const SCHEDULER_COL = /next_run_at|last_run_at|CAST\(\w+\.created_at AS INTEGER\)/;
    const bad: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      for (const [i, line] of text.split('\n').entries()) {
        if (BANNED[2].test(line) && !SCHEDULER_COL.test(line)) {
          bad.push(`${path.replace('../../', '')}:${i + 1}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('never binds epoch seconds into a column', () => {
    // The narrow, provable version: `Math.floor(Date.now() / 1000)` inside a `.bind(`
    // is a write of epoch seconds into a column, which is what produced the ISO-vs-epoch
    // comparisons that silently disabled the activity feed's time window and left
    // `artifact_emails.inbound_enabled_at` an INTEGER. Epoch seconds elsewhere — a JWT
    // `exp`, a Slack API `ts`, a retry-after subtraction — are correct and not flagged.
    // The scheduler cursors bind epoch by design (CONVENTIONS.md § Timestamps).
    const SCHEDULER = ['src/scheduling/', 'src/crew/', 'src/metric-alerts/'];
    const bad: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      const rel = path.replace('../../', '');
      if (SCHEDULER.some((prefix) => rel.startsWith(prefix))) continue;
      for (const [i, line] of text.split('\n').entries()) {
        if (/\.bind\(/.test(line) && /Math\.floor\(Date\.now\(\) \/ 1000\)/.test(line)) {
          bad.push(`${rel}:${i + 1}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
