import { describe, expect, it } from 'vitest';
import { DEFAULT_EDITOR_BASE_URL, getEditorBaseUrl } from '../../../../src/editor/page/config';

describe('getEditorBaseUrl', () => {
  it('returns the default ShareOut base URL when no override is given', () => {
    expect(getEditorBaseUrl()).toBe(DEFAULT_EDITOR_BASE_URL);
    expect(DEFAULT_EDITOR_BASE_URL).toBe('https://shareout.site');
  });

  it('returns a custom override when provided', () => {
    expect(getEditorBaseUrl('https://custom.example')).toBe('https://custom.example');
  });
});
