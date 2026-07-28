import { describe, expect, it } from 'vitest';
import { generateWorkspaceSlug, SLUG_REGEX } from '../../../src/workspaces/slug';

describe('workspace slug', () => {
  it('generates a lowercase hyphenated slug from a name', () => {
    expect(generateWorkspaceSlug('Acme Revenue Dashboard')).toBe('acme-revenue-dashboard');
  });

  it('strips leading and trailing hyphens', () => {
    expect(generateWorkspaceSlug('---Hello---')).toBe('hello');
  });

  it('truncates to 30 characters', () => {
    const slug = generateWorkspaceSlug('abcdefghijklmnopqrstuvwxyz1234567890');
    expect(slug.length).toBeLessThanOrEqual(30);
  });

  it('falls back to workspace when name has no alphanumerics', () => {
    expect(generateWorkspaceSlug('!!!')).toBe('workspace');
  });

  it('accepts valid slugs via SLUG_REGEX', () => {
    expect(SLUG_REGEX.test('acme')).toBe(true);
    expect(SLUG_REGEX.test('acme-revenue')).toBe(true);
    expect(SLUG_REGEX.test('-bad')).toBe(false);
    expect(SLUG_REGEX.test('bad-')).toBe(false);
  });
});
