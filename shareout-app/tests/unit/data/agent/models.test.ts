import { describe, expect, it } from 'vitest';
import { thinkingOffParams, temperatureParams } from '../../../../src/data/agent/models';

describe('thinkingOffParams', () => {
  it('uses between_tools on Sonnet 5.5, which rejects disabled', () => {
    expect(thinkingOffParams('claude-sonnet-5-5')).toEqual({ thinking: { type: 'between_tools' } });
    expect(thinkingOffParams('anthropic/claude-sonnet-5.5')).toEqual({ thinking: { type: 'between_tools' } });
  });
  it('omits thinking where it cannot be turned off', () => {
    expect(thinkingOffParams('claude-opus-5-5')).toEqual({});
    expect(thinkingOffParams('claude-fable-5-1')).toEqual({});
  });
  it('disables thinking on older models', () => {
    expect(thinkingOffParams('claude-sonnet-5')).toEqual({ thinking: { type: 'disabled' } });
  });
});

describe('temperatureParams', () => {
  it('drops temperature for Claude models and keeps it for others', () => {
    expect(temperatureParams('anthropic/claude-sonnet-5.5', 0)).toEqual({});
    expect(temperatureParams('gpt-4o', 0)).toEqual({ temperature: 0 });
  });
});
