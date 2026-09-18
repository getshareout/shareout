// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FetchTimeoutError } from '../../../src/fetch-utils';
import { UpstreamHttpError } from '../../../src/data/connections/errors';
import {
  userFacingCrewRunError,
  userFacingCrewToolError,
  userFacingCrewProviderError,
  userFacingWebSearchToolError,
  userFacingPilotVerifyToolError,
} from '../../../src/crew/errors';

describe('crew/errors', () => {
  it('userFacingCrewToolError preserves safe validation messages', () => {
    expect(userFacingCrewToolError(new Error('table is required'))).toBe('table is required');
  });

  it('userFacingCrewToolError maps upstream failures without leaking bodies', () => {
    expect(userFacingCrewToolError(new FetchTimeoutError('timeout'))).toBe('The connected API timed out');
    expect(userFacingCrewToolError(new UpstreamHttpError(502, 'Snowflake: invalid JWT abc'))).toBe(
      'The connected API is unavailable (HTTP 502)',
    );
  });

  it('userFacingCrewToolError hides internal err.message', () => {
    expect(userFacingCrewToolError(new Error('D1_ERROR: no such table: crew_runs'))).toBe('Tool failed.');
    expect(userFacingCrewToolError(new Error('decrypt failed: bad key'))).toBe('Tool failed.');
  });

  it('userFacingCrewRunError never echoes provider or infra text', () => {
    expect(userFacingCrewRunError('AI gateway error 502: {"secret":"x"}')).toBe('The crew run failed. Try again.');
    expect(userFacingCrewRunError(new Error('D1_ERROR: disk I/O'))).toBe('The crew run failed. Try again.');
  });

  it('userFacingCrewProviderError never echoes gateway bodies or status', () => {
    expect(userFacingCrewProviderError(new Error('AI gateway error 502: {"secret":"x"}'), 502)).toBe(
      'The AI service is temporarily unavailable. Try again.',
    );
  });

  it('userFacingWebSearchToolError hides provider HTTP internals', () => {
    expect(userFacingWebSearchToolError(new Error('Brave HTTP 502 upstream body'))).toBe('Web search failed.');
    expect(userFacingWebSearchToolError(new Error('DuckDuckGo HTTP 503'))).toBe('Web search failed.');
  });

  it('userFacingPilotVerifyToolError hides puppeteer and browser protocol internals', () => {
    expect(
      userFacingPilotVerifyToolError(new Error('Protocol error (Page.navigate): Target closed')),
    ).toBe('Pilot verify failed.');
    expect(userFacingPilotVerifyToolError(new Error('Navigation timeout of 20000 ms exceeded'))).toBe(
      'Pilot verify failed.',
    );
  });
});
