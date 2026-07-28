// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { stripEditorAttributes } from '../src/dom/editor-ids';

describe('stripEditorAttributes', () => {
  it('removes editor-internal attributes but preserves content + author attrs', () => {
    const html =
      '<!DOCTYPE html><html><head></head><body>' +
      '<div data-editor-id="a" data-locked-by="u1">' +
      '<p data-editor-id="b" data-editor-selected="true" data-key="title">Hi</p>' +
      '</div></body></html>';

    const out = stripEditorAttributes(html);

    expect(out).not.toContain('data-editor-id');
    expect(out).not.toContain('data-locked-by');
    expect(out).not.toContain('data-editor-selected');
    expect(out).not.toContain('data-editor-hover');
    // Author content + ShareOut binding attributes survive untouched.
    expect(out).toContain('data-key="title"');
    expect(out).toContain('Hi');
    expect(out).toMatch(/^<!DOCTYPE html>/i);
  });

  it('returns empty input unchanged', () => {
    expect(stripEditorAttributes('')).toBe('');
  });
});
