// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildEditorSystemPrompt } from '../../../src/editor/chat/index';
import { clipHtml } from '../../../src/editor/chat/prompts';
import type { EditorChatRequest } from '../../../src/editor/types';

function ctx(overrides: Partial<EditorChatRequest['context']> = {}): EditorChatRequest['context'] {
  return { documentHtml: '<div data-editor-id="x">hi</div>', ...overrides };
}

describe('buildEditorSystemPrompt', () => {
  it('renders the data model from the manifest + data-editor-id targeting guidance', () => {
    const prompt = buildEditorSystemPrompt(ctx({
      manifest: {
        json: [{ key: 'title', type: 'string' }],
        tables: [{
          name: 'orders',
          fields: [
            { name: 'total', type: 'number', primary: false },
            { name: 'id', type: 'string', primary: true },
          ],
        }],
        computed: [{ name: 'revenue', formula: 'sum(orders.total)' }],
        formatters: ['usd'],
        realtime: ['live'],
        blobs: ['logo.png'],
      },
    }));

    expect(prompt).toContain('DATA MODEL');
    expect(prompt).toContain('title (string)');
    expect(prompt).toContain('Table "orders"');
    expect(prompt).toContain('total:number');
    expect(prompt).toContain('id:string [pk]');
    expect(prompt).toContain('revenue = sum(orders.total)');
    expect(prompt).toContain('Realtime docs: live');
    expect(prompt).toContain('data-editor-id');
  });

  it('omits the data model section when there is no manifest', () => {
    const prompt = buildEditorSystemPrompt(ctx());
    expect(prompt).not.toContain('DATA MODEL');
    // still mentions the stable-id targeting convention
    expect(prompt).toContain('data-editor-id');
  });
});

describe('clipHtml', () => {
  it('passes short documents through untouched', () => {
    expect(clipHtml('<p>hi</p>', 100)).toBe('<p>hi</p>');
    expect(clipHtml(undefined, 100)).toBe('');
  });

  it('tells the model when the document was truncated', () => {
    const out = clipHtml('x'.repeat(50), 10);
    expect(out.startsWith('x'.repeat(10) + '\n')).toBe(true);
    expect(out).toContain('TRUNCATED: only the first 10 of 50 characters');
  });

  it('marks a truncated document in the normal editor prompt', () => {
    const prompt = buildEditorSystemPrompt({ documentHtml: '<p>' + 'a'.repeat(40_100) + '</p>' });
    expect(prompt).toContain('TRUNCATED');
    expect(buildEditorSystemPrompt({ documentHtml: '<p>short</p>' })).not.toContain('TRUNCATED');
  });
});
