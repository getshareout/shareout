// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  userFacingAdminContextFailure,
  userFacingAgentChatFailure,
  userFacingAgentCompletionError,
  userFacingAgentStreamError,
  userFacingAnalystFailure,
  userFacingApplyEditError,
  userFacingPilotUpstreamError,
  pilotUpstreamErrorBody,
} from '../../../../src/data/agent/errors';

describe('agent error sanitization', () => {
  it('maps upstream AI API bodies to a generic message', () => {
    expect(userFacingAgentStreamError('AI API error: 401 {"error":"invalid_api_key"}'))
      .toBe('AI request failed');
    expect(userFacingAgentStreamError('AI API error: 500 internal server error body'))
      .toBe('AI request failed');
  });

  it('preserves safe timeout messaging', () => {
    expect(userFacingAgentStreamError('AI API request timed out')).toBe('AI API request timed out');
  });

  it('maps rate-limit and timeout HTTP statuses from upstream errors', () => {
    expect(userFacingAgentStreamError('AI API error: 429 too many requests')).toBe(
      'AI service is busy. Try again shortly.',
    );
    expect(userFacingAgentStreamError('AI API error: 504 gateway timeout')).toBe(
      'AI request timed out',
    );
  });

  it('never leaks internal exception text from chat failures', () => {
    expect(userFacingAgentChatFailure(new Error('D1_ERROR: no such table'))).toBe('Chat failed');
    expect(userFacingAdminContextFailure(new Error('crypto.subtle unavailable'))).toBe(
      'Failed to build context',
    );
  });

  it('maps upstream AI completion errors to safe slides messages', () => {
    expect(
      userFacingAgentCompletionError(new Error('AI API error: 401 {"error":"invalid_api_key"}')),
    ).toBe('AI request failed');
    expect(userFacingAgentCompletionError(new Error('D1_ERROR: disk I/O error'))).toBe('Generation failed');
    expect(userFacingAgentCompletionError(new Error('AI API error: 429 too many'))).toBe(
      'AI service is busy. Try again shortly.',
    );
  });

  it('maps analyst ask failures to safe messages without leaking internals', () => {
    expect(
      userFacingAnalystFailure(new Error('AI API error: 401 {"error":"invalid_api_key"}')),
    ).toBe('AI request failed');
    expect(userFacingAnalystFailure(new Error('D1_ERROR: no such table'))).toBe('Analyst request failed');
    expect(userFacingAnalystFailure(new Error('AI API error: 429 too many'))).toBe(
      'AI service is busy. Try again shortly.',
    );
  });

  it('preserves safe apply-edit validation messages only', () => {
    expect(userFacingApplyEditError(new Error('Search text not found'))).toBe('Search text not found');
    expect(userFacingApplyEditError(new Error('D1_ERROR: disk I/O error'))).toBe('Failed to apply edit');
  });

  it('maps pilot upstream HTTP statuses to safe messages', () => {
    expect(userFacingPilotUpstreamError(401)).toBe('AI request failed');
    expect(userFacingPilotUpstreamError(500)).toBe('AI request failed');
    expect(userFacingPilotUpstreamError(429)).toBe('AI service is busy. Try again shortly.');
    expect(userFacingPilotUpstreamError(504)).toBe('AI request timed out');
  });

  it('builds OpenAI-compatible pilot error bodies without upstream leak', () => {
    const body = pilotUpstreamErrorBody(401);
    expect(body).toEqual({
      error: {
        message: 'AI request failed',
        type: 'upstream_error',
        code: 'UPSTREAM_ERROR',
      },
    });
    expect(JSON.stringify(body)).not.toContain('invalid_api_key');
  });
});
