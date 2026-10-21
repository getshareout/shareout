import { describe, expect, it } from 'vitest';
import { isBlockedDestination } from '../../../src/data/secrets/blocklist';

describe('f35b blocklist trailing-dot hosts', () => {
  it('blocks: trailing-dot forms of internal hosts', () => {
    for (const u of ['https://localhost./', 'https://localhost../x', 'http://127.0.0.1./', 'https://169.254.169.254./latest']) {
      expect(isBlockedDestination(u).blocked, u).toBe(true);
    }
  });

  it('still allows public hosts', () => {
    expect(isBlockedDestination('https://example.com./').blocked).toBe(false);
    expect(isBlockedDestination('https://api.example.com/v1').blocked).toBe(false);
  });
});
