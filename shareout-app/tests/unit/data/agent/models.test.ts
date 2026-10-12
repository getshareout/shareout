import { describe, expect, it } from 'vitest';
import { claudeModelById, gatewayReasoningParams, thinkingOffParams, temperatureParams } from '../../../../src/data/agent/models';

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

describe('gatewayReasoningParams', () => {
  it('asks the gateway for low effort on Claude 5.x, which cannot turn thinking off there', () => {
    expect(gatewayReasoningParams('anthropic/claude-sonnet-5.5')).toEqual({ reasoning: { effort: 'low' } });
    expect(gatewayReasoningParams('anthropic/claude-opus-5')).toEqual({ reasoning: { effort: 'low' } });
  });
  it('leaves other models alone', () => {
    expect(gatewayReasoningParams('anthropic/claude-haiku-4.5')).toEqual({});
    expect(gatewayReasoningParams('openai/gpt-4o')).toEqual({});
  });
});

describe('temperatureParams', () => {
  it('drops temperature for Claude models and keeps it for others', () => {
    expect(temperatureParams('anthropic/claude-sonnet-5.5', 0)).toEqual({});
    expect(temperatureParams('gpt-4o', 0)).toEqual({ temperature: 0 });
  });
});

describe('claudeModelById', () => {
  it('resolves first-party ids, gateway slugs and the undated alias', () => {
    for (const id of ['claude-haiku-4-5-20251001', 'anthropic/claude-haiku-4.5', 'claude-haiku-4-5']) {
      expect(claudeModelById(id)?.gateway).toBe('anthropic/claude-haiku-4.5');
    }
    expect(claudeModelById('claude-sonnet-5-5')?.gateway).toBe('anthropic/claude-sonnet-5.5');
  });

  it('is null for retired or unknown ids', () => {
    expect(claudeModelById('claude-sonnet-4-20250514')).toBeNull();
    expect(claudeModelById('')).toBeNull();
  });
});
