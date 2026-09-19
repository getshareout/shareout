import { describe, expect, it } from 'vitest';
import { publicLimitNotice, rateLimitMessage, storageLimitMessage } from '../../../src/publish/limits';

describe('publish limit copy', () => {
  const reset = Date.UTC(2026, 4, 31) / 1000;

  it('states the daily limit, the reset time, and a short wait in minutes', () => {
    expect(rateLimitMessage(reset, reset * 1000 - 60_000))
      .toBe('Daily publish limit reached (100 per day). It resets at 00:00 UTC, in about 1 minute.');
    expect(rateLimitMessage(reset, reset * 1000 - 25 * 60_000)).toMatch(/in about 25 minutes\.$/);
  });

  it('switches to hours for long waits', () => {
    expect(rateLimitMessage(reset, reset * 1000 - 23 * 3600_000)).toMatch(/in about 23 hours\.$/);
  });

  it('never points at a billing upgrade that does not exist', () => {
    const storage = storageLimitMessage({ allowed: false, used: 250_000_000, incoming: 1, max: 250_000_000 });
    expect(storage).toMatch(/250 MB of 250 MB/);
    expect(storage).toMatch(/STORAGE_QUOTA_BYTES/);
    expect(publicLimitNotice(5)).toMatch(/\(5 per account\).*PUBLIC_ARTIFACT_LIMIT/);
    for (const copy of [storage, publicLimitNotice(5)]) expect(copy).not.toMatch(/upgrade/i);
  });
});
