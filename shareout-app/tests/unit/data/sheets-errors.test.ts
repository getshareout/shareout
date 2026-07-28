// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { userFacingSheetsOAuthError } from '../../../src/data/sheets/errors';

describe('userFacingSheetsOAuthError', () => {
  it('returns a generic message for any error', () => {
    expect(userFacingSheetsOAuthError(new Error('Token exchange failed: secret'))).toBe(
      'Google Sheets authorization failed',
    );
    expect(userFacingSheetsOAuthError('boom')).toBe('Google Sheets authorization failed');
    expect(userFacingSheetsOAuthError(null)).toBe('Google Sheets authorization failed');
  });
});
