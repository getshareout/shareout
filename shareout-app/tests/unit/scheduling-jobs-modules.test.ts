/**
 * Smoke tests for the decomposed scheduling/jobs modules — ensures the barrel
 * re-exports every public symbol and cron helpers behave as expected.
 */
import { describe, expect, it } from 'vitest';
import { calculateBackoffDelay } from '../../src/scheduling/jobs/retry';
import { parseCronSchedule, getNextRunTime } from '../../src/scheduling/jobs/cron';
import {
  createJob,
  deleteJob,
  executeJobNow,
  getNextRunTime as barrelNextRun,
  hasEnabledViewEventJob,
  parseCronSchedule as barrelParseCron,
  runScheduledJobs,
} from '../../src/scheduling/jobs';

describe('scheduling/jobs modules', () => {
  it('exports core symbols from the jobs barrel', () => {
    expect(typeof createJob).toBe('function');
    expect(typeof deleteJob).toBe('function');
    expect(typeof executeJobNow).toBe('function');
    expect(typeof runScheduledJobs).toBe('function');
    expect(typeof hasEnabledViewEventJob).toBe('function');
    expect(barrelParseCron).toBe(parseCronSchedule);
    expect(barrelNextRun).toBe(getNextRunTime);
  });

  it('parseCronSchedule rejects invalid expressions', () => {
    expect(parseCronSchedule('not-cron').valid).toBe(false);
    expect(parseCronSchedule('0 9 * * *').valid).toBe(true);
  });

  it('calculateBackoffDelay scales by strategy', () => {
    const base = { maxAttempts: 3, initialDelay: 100, backoffType: 'fixed' as const };
    expect(calculateBackoffDelay(base, 0)).toBe(100);
    expect(calculateBackoffDelay({ ...base, backoffType: 'linear' }, 1)).toBe(200);
    expect(calculateBackoffDelay({ ...base, backoffType: 'exponential' }, 2)).toBe(400);
  });

  it('getNextRunTime returns a future ISO-8601 UTC instant', () => {
    const from = new Date('2026-01-15T08:30:00.000Z');
    const next = getNextRunTime('0 9 * * *', from);
    expect(Date.parse(next)).toBeGreaterThan(from.getTime());
  });
});
