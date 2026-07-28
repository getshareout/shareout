/**
 * The scheduled_jobs enum guards that replaced D1's BEFORE INSERT/UPDATE triggers
 * (dropped in migration 0135). If these regress, invalid `action`, `trigger_type`,
 * `backoff_type` or `event_type` values reach the database unchallenged — nothing
 * downstream checks them any more.
 */
import { describe, expect, it } from 'vitest';
import { getDestination } from '../../src/delivery/registry';
import {
  JOB_ACTIONS,
  JOB_BACKOFF_TYPES,
  JOB_EVENT_TYPES,
  JOB_TRIGGER_TYPES,
  isJobAction,
  isJobBackoffType,
  isJobEventType,
  isJobTriggerType,
} from '../../src/scheduling/jobs/types';

const CASES = [
  ['action', JOB_ACTIONS, isJobAction],
  ['trigger_type', JOB_TRIGGER_TYPES, isJobTriggerType],
  ['event_type', JOB_EVENT_TYPES, isJobEventType],
  ['backoff_type', JOB_BACKOFF_TYPES, isJobBackoffType],
] as const;

describe('scheduled_jobs enum guards', () => {
  for (const [column, allowed, guard] of CASES) {
    it(`${column} accepts every declared value and nothing else`, () => {
      for (const value of allowed) {
        expect(guard(value)).toBe(true);
      }
      for (const value of ['', 'banana', 'EMAIL', null, undefined, 0, {}]) {
        expect(guard(value)).toBe(false);
      }
    });
  }

  it('no longer allows report_daily, which the dropped trigger still permitted', () => {
    expect(isJobAction('report_daily')).toBe(false);
  });

  // createJob's only check on `action` is that a destination exists for it, so the
  // two lists have to agree or an action becomes unwritable.
  it('every action has a delivery destination', () => {
    for (const action of JOB_ACTIONS) {
      expect(getDestination(action), `no destination for ${action}`).toBeTruthy();
    }
  });
});
