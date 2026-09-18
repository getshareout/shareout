// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FetchTimeoutError } from '../../../src/fetch-utils';
import { UpstreamHttpError } from '../../../src/data/connections/errors';
import { userFacingAgentToolError, userFacingClientNotesError, userFacingReadFileError } from '../../../src/chat-agent/errors';

describe('chat-agent/errors', () => {
  it('preserves safe validation messages', () => {
    expect(userFacingAgentToolError(new Error('file_id is required'))).toBe('file_id is required');
    expect(userFacingAgentToolError(new Error('No file "f1" in your library.'))).toBe('No file "f1" in your library.');
  });

  it('maps upstream connection failures without leaking bodies', () => {
    expect(userFacingAgentToolError(new FetchTimeoutError('timeout'))).toBe('The connected API timed out');
    expect(userFacingAgentToolError(new UpstreamHttpError(502, 'Snowflake: invalid JWT abc'))).toBe(
      'The connected API is unavailable (HTTP 502)',
    );
  });

  it('returns generic message for internal failures without leaking err.message', () => {
    expect(userFacingAgentToolError(new Error('D1_ERROR: no such table: artifacts'))).toBe('Tool failed.');
    expect(userFacingAgentToolError(new Error('decrypt failed: bad key'))).toBe('Tool failed.');
    expect(userFacingAgentToolError('boom')).toBe('Tool failed.');
  });

  it('userFacingReadFileError preserves safe size limits and hides parser internals', () => {
    expect(userFacingReadFileError(new Error('Spreadsheet too large to read (max 8MB)'), 'data.xlsx')).toBe(
      'Spreadsheet too large to read (max 8MB)',
    );
    expect(userFacingReadFileError(new Error('invalid zip header'), 'deck.pptx')).toBe(
      'Could not read deck.pptx. The file may be corrupted or in an unsupported format.',
    );
    expect(userFacingReadFileError(new Error('D1_ERROR: blob read failed'), 'notes.txt')).toBe(
      'Could not read notes.txt. The file may be corrupted or in an unsupported format.',
    );
  });

  it('userFacingClientNotesError maps known upsert codes and hides internals', () => {
    expect(userFacingClientNotesError('EMPTY_CONTENT')).toBe('Note content cannot be empty.');
    expect(userFacingClientNotesError('TOO_LARGE')).toBe('Note is too large (max 64KB).');
    expect(userFacingClientNotesError('D1_ERROR: disk I/O error')).toBe('Couldn\u2019t save the note. Try again.');
    expect(userFacingClientNotesError(new Error('D1_ERROR: no such table'))).toBe('Couldn\u2019t save the note. Try again.');
  });
});
