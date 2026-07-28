import { describe, it, expect } from 'vitest';
import { isSlackAuthError, userFacingSlackDeliveryError } from '../../src/slack/send';

describe('isSlackAuthError', () => {
  it('flags revoked/expired/invalid tokens and missing scopes', () => {
    for (const msg of [
      'conversations.list failed: token_revoked',
      'chat.postMessage failed: invalid_auth',
      'conversations.open failed: missing_scope',
      'Error: users.list failed: account_inactive',
      'token_expired',
    ]) {
      expect(isSlackAuthError(msg)).toBe(true);
    }
  });

  it('does not flag transient/unknown failures', () => {
    for (const msg of [
      'conversations.list failed: ratelimited',
      'chat.postMessage failed: channel_not_found',
      'conversations.list failed: unknown_error',
      'Slack member not found: leonel',
    ]) {
      expect(isSlackAuthError(msg)).toBe(false);
    }
  });

  it('is safe with null/undefined/empty', () => {
    expect(isSlackAuthError(null)).toBe(false);
    expect(isSlackAuthError(undefined)).toBe(false);
    expect(isSlackAuthError('')).toBe(false);
  });
});

describe('userFacingSlackDeliveryError', () => {
  it('maps auth failures to SLACK_AUTH', () => {
    const facing = userFacingSlackDeliveryError('chat.postMessage failed: invalid_auth');
    expect(facing).toMatchObject({
      code: 'SLACK_AUTH',
      status: 400,
    });
    expect(facing.message).not.toContain('invalid_auth');
  });

  it('preserves safe domain errors', () => {
    expect(userFacingSlackDeliveryError("Slack connection 'team-slack' not found")).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: "Slack connection 'team-slack' not found",
    });
    expect(userFacingSlackDeliveryError('Snapshot render failed')).toMatchObject({
      code: 'RENDER_ERROR',
      status: 502,
    });
  });

  it('sanitizes unknown Slack failures', () => {
    const facing = userFacingSlackDeliveryError('files.completeUploadExternal failed: not_in_channel');
    expect(facing).toMatchObject({ code: 'SLACK_ERROR', status: 502, message: 'Failed to deliver to Slack' });
    expect(facing.message).not.toContain('not_in_channel');
  });
});
