import { describe, it, expect } from 'vitest';
import { extractStreamingReply } from '../src/chat/stream-reply';

describe('extractStreamingReply', () => {
  it('returns null before the reply value starts', () => {
    expect(extractStreamingReply('')).toBeNull();
    expect(extractStreamingReply('{"chan')).toBeNull();
    expect(extractStreamingReply('{"reply"')).toBeNull();
    expect(extractStreamingReply('{"reply":')).toBeNull();
    expect(extractStreamingReply('{"reply": ')).toBeNull();
  });

  it('streams the reply prose as the JSON grows', () => {
    expect(extractStreamingReply('{"reply":"Hello')).toBe('Hello');
    expect(extractStreamingReply('{"reply":"Hello, wor')).toBe('Hello, wor');
    expect(extractStreamingReply('{"reply":"Hello, world"')).toBe('Hello, world');
    expect(extractStreamingReply('{"reply":"Hello, world","changes":null}')).toBe('Hello, world');
  });

  it('decodes escapes and stops at the closing quote', () => {
    expect(extractStreamingReply('{"reply":"line1\\nline2"}')).toBe('line1\nline2');
    expect(extractStreamingReply('{"reply":"a \\"quote\\" here"}')).toBe('a "quote" here');
    expect(extractStreamingReply('{"reply":"path \\/ slash"}')).toBe('path / slash');
  });

  it('handles an incomplete trailing escape gracefully', () => {
    expect(extractStreamingReply('{"reply":"done\\')).toBe('done');
  });

  it('tolerates a leading code fence', () => {
    expect(extractStreamingReply('```json\n{"reply":"Hi"')).toBe('Hi');
  });

  it('ends the reply at its closing quote, ignoring later payload', () => {
    expect(
      extractStreamingReply('{"reply":"first","changes":{"patches":[{"content":"reply"}]}}'),
    ).toBe('first');
  });
});
