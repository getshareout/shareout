import { describe, expect, it } from 'vitest';
import { computeBaseCostMicroUsd } from '../../../../src/data/agent/model-costs';
import { CLAUDE_HAIKU, CLAUDE_OPUS, CLAUDE_SONNET } from '../../../../src/data/agent/models';

const M = 1_000_000;

describe('computeBaseCostMicroUsd', () => {
  it('prices the current Claude models by first-party id and gateway slug', () => {
    for (const m of [CLAUDE_SONNET.id, CLAUDE_SONNET.gateway]) expect(computeBaseCostMicroUsd(m, M, M)).toBe(12 * M);
    for (const m of [CLAUDE_OPUS.id, CLAUDE_OPUS.gateway]) expect(computeBaseCostMicroUsd(m, M, M)).toBe(30 * M);
    for (const m of [CLAUDE_HAIKU.id, CLAUDE_HAIKU.gateway]) expect(computeBaseCostMicroUsd(m, M, M)).toBe(6 * M);
  });

  it('falls back to gpt-4o pricing for an unknown model', () => {
    expect(computeBaseCostMicroUsd('mystery', M, M)).toBe(12.5 * M);
  });
});
