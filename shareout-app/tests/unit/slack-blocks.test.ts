import { describe, it, expect } from 'vitest';
import { invalidSlackBlocks } from '../../src/slack/send';

describe('invalidSlackBlocks', () => {
  it('accepts a normal Block Kit body', () => {
    expect(invalidSlackBlocks([
      { type: 'section', text: { type: 'mrkdwn', text: '*hi*' } },
      { type: 'divider' },
    ])).toBeNull();
  });

  it('rejects anything that is not an array', () => {
    for (const bad of [{}, 'section', 42, null]) {
      expect(invalidSlackBlocks(bad)).toBe('blocks must be an array');
    }
  });

  it('rejects an empty array rather than posting a bodyless message', () => {
    expect(invalidSlackBlocks([])).toBe('blocks must not be empty');
  });

  it('caps the body below Slack’s 50-block limit, leaving room for header and button', () => {
    const body = Array.from({ length: 46 }, () => ({ type: 'divider' }));
    expect(invalidSlackBlocks(body)).toBe('blocks must contain at most 45 entries');
    expect(invalidSlackBlocks(body.slice(0, 45))).toBeNull();
  });

  it('rejects entries that are not objects', () => {
    expect(invalidSlackBlocks(['divider'])).toBe('each block must be an object');
    expect(invalidSlackBlocks([null])).toBe('each block must be an object');
    expect(invalidSlackBlocks([[{ type: 'divider' }]])).toBe('each block must be an object');
  });

  it('requires a string type so Slack does not reject the whole post', () => {
    expect(invalidSlackBlocks([{ text: 'no type' }])).toBe('each block must have a string "type"');
    expect(invalidSlackBlocks([{ type: 7 }])).toBe('each block must have a string "type"');
  });
});
