import { describe, expect, it } from 'vitest';
import {
  isEmailAllowedByPolicy,
  normalizeDomain,
  parseJsonList,
} from '../../../src/workspaces/access-policy';

describe('workspace access policy helpers', () => {
  it('parseJsonList returns an empty array for null or invalid JSON', () => {
    expect(parseJsonList(null)).toEqual([]);
    expect(parseJsonList('not-json')).toEqual([]);
    expect(parseJsonList('{"x":1}')).toEqual([]);
  });

  it('parseJsonList keeps only string entries', () => {
    expect(parseJsonList('["a.com",1,null,"b.com"]')).toEqual(['a.com', 'b.com']);
  });

  it('normalizeDomain lowercases and strips leading @', () => {
    expect(normalizeDomain(' @Example.COM ')).toBe('example.com');
  });

  it('isEmailAllowedByPolicy allows all emails when lists are empty', () => {
    expect(isEmailAllowedByPolicy({ allowed_domains: [], allowed_emails: [] }, 'any@where.com')).toBe(true);
  });

  it('isEmailAllowedByPolicy matches explicit emails', () => {
    const policy = { allowed_domains: [], allowed_emails: ['ceo@acme.com'] };
    expect(isEmailAllowedByPolicy(policy, 'ceo@acme.com')).toBe(true);
    expect(isEmailAllowedByPolicy(policy, 'other@acme.com')).toBe(false);
  });

  it('isEmailAllowedByPolicy matches allowed domains', () => {
    const policy = { allowed_domains: ['acme.com'], allowed_emails: [] };
    expect(isEmailAllowedByPolicy(policy, 'user@acme.com')).toBe(true);
    expect(isEmailAllowedByPolicy(policy, 'user@other.com')).toBe(false);
  });
});
