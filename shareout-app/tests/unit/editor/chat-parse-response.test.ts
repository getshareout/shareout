// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseAgentResponse } from '../../../src/editor/chat/parse-response';

describe('parseAgentResponse', () => {
  it('parses the modern reply + changes schema', () => {
    const result = parseAgentResponse(JSON.stringify({
      reply: 'Updated the hero.',
      changes: {
        patches: [{ selector: '#hero', action: 'replace', content: '<h1>Hi</h1>' }],
      },
    }));

    expect(result).toEqual({
      type: 'html_patch',
      patches: [{ selector: '#hero', action: 'replace', content: '<h1>Hi</h1>' }],
      html: undefined,
      actions: undefined,
      message: 'Updated the hero.',
    });
  });

  it('extracts JSON wrapped in markdown fences', () => {
    const result = parseAgentResponse(`Here you go:\n\`\`\`json\n{"reply":"ok","changes":null}\n\`\`\``);
    expect(result).toEqual({
      type: 'explanation',
      message: 'ok',
    });
  });

  it('falls back to plain explanation text when JSON is invalid', () => {
    const result = parseAgentResponse('Just a conversational answer.');
    expect(result).toEqual({
      type: 'explanation',
      message: 'Just a conversational answer.',
    });
  });

  it('supports legacy patch payloads', () => {
    const result = parseAgentResponse(JSON.stringify({
      patches: [{ selector: '.btn', action: 'setStyle', value: 'red' }],
      message: 'Styled the button.',
    }));

    expect(result.type).toBe('html_patch');
    expect(result.message).toBe('Styled the button.');
    expect(result.patches).toHaveLength(1);
  });
});
