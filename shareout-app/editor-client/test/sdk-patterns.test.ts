import { describe, expect, it } from 'vitest';
import { SDK_DETECTION_PATTERNS } from '../src/sdk-patterns';

describe('SDK_DETECTION_PATTERNS', () => {
  it('detects sdk.table with quoted name', () => {
    const html = "await sdk.table('orders').fetch();";
    const match = html.match(SDK_DETECTION_PATTERNS.table);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('orders');
  });

  it('detects sdk.table with backtick name', () => {
    const html = 'await sdk.table(`metrics`).fetch();';
    const match = html.match(SDK_DETECTION_PATTERNS.table);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('metrics');
  });

  it('detects json, blob, and realtime with backtick names', () => {
    expect("sdk.json.get(`settings`)".match(SDK_DETECTION_PATTERNS.json)?.[1]).toBe('settings');
    expect('sdk.blob(`logo`)'.match(SDK_DETECTION_PATTERNS.blob)?.[1]).toBe('logo');
    expect('sdk.realtime(`presence`)'.match(SDK_DETECTION_PATTERNS.realtime)?.[1]).toBe('presence');
  });

  it('detects parameterless sdk helpers', () => {
    expect('sdk.comments()'.match(SDK_DETECTION_PATTERNS.comments)).not.toBeNull();
    expect('sdk.agent()'.match(SDK_DETECTION_PATTERNS.agent)).not.toBeNull();
  });

  it('are valid RegExp instances (no syntax error at load)', () => {
    for (const pattern of Object.values(SDK_DETECTION_PATTERNS)) {
      expect(pattern.test('')).toBe(false);
    }
  });
});
