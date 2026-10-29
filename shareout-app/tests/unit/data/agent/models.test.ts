import { describe, expect, it } from 'vitest';
import { anthropicEffortParams, claudeModelById, gatewayReasoningParams, parseBuildEffort, thinkingOffParams, temperatureParams } from '../../../../src/data/agent/models';

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

describe('build effort', () => {
  it('lets the caller pick the gateway effort; the default stays low for chat and crew', () => {
    expect(gatewayReasoningParams('anthropic/claude-sonnet-5.5', 'medium')).toEqual({ reasoning: { effort: 'medium' } });
    expect(gatewayReasoningParams('anthropic/claude-opus-5', 'high')).toEqual({ reasoning: { effort: 'high' } });
    expect(gatewayReasoningParams('openai/gpt-4o', 'high')).toEqual({});
  });
  it('sends output_config.effort on direct Anthropic Sonnet/Opus 5.x only', () => {
    expect(anthropicEffortParams('claude-sonnet-5-5', 'medium')).toEqual({ output_config: { effort: 'medium' } });
    expect(anthropicEffortParams('claude-opus-5', 'high')).toEqual({ output_config: { effort: 'high' } });
    expect(anthropicEffortParams('claude-haiku-4-5-20251001', 'high')).toEqual({});
  });
  it('validates BUILD_EFFORT: low, medium, high, else medium', () => {
    expect(parseBuildEffort('low')).toBe('low');
    expect(parseBuildEffort(' HIGH ')).toBe('high');
    expect(parseBuildEffort(undefined)).toBe('medium');
    expect(parseBuildEffort('max')).toBe('medium');
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
