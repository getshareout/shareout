// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mapScenarioFailure, userFacingScenarioError } from '../../../src/demo/errors';

describe('demo/errors', () => {
  it('preserves safe unknown-scenario messages', () => {
    expect(userFacingScenarioError(new Error('unknown scenario: foo'))).toBe('unknown scenario: foo');
    expect(mapScenarioFailure(new Error('unknown scenario: foo'))).toEqual({
      message: 'unknown scenario: foo',
      code: 'SCENARIO_ERROR',
      status: 400,
    });
  });

  it('preserves safe missing-artifact setup messages', () => {
    const msg = 'artifact "drop-terra-verde" not found — publish the tracker (P3b) first';
    expect(userFacingScenarioError(new Error(msg))).toBe(msg);
    expect(mapScenarioFailure(new Error(msg))).toEqual({
      message: msg,
      code: 'SCENARIO_ERROR',
      status: 400,
    });
  });

  it('returns generic message for internal failures without leaking err.message', () => {
    expect(userFacingScenarioError(new Error('D1_ERROR: no such table: artifacts'))).toBe('Scenario build failed');
    expect(mapScenarioFailure(new Error('D1_ERROR: no such table: artifacts'))).toEqual({
      message: 'Scenario build failed',
      code: 'SCENARIO_ERROR',
      status: 500,
    });
  });
});
