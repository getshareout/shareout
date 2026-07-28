// @vitest-environment node
import { describe, expect, it } from 'vitest';
import '../../../../src/data/platform/providers/google-sheets';
import {
  getProvider,
  hasProvider,
  initializeProviders,
  listProviders,
  registerProvider,
} from '../../../../src/data/platform/registry';
import { googleSheetsProvider } from '../../../../src/data/platform/providers/google-sheets';

describe('platform registry', () => {
  it('registers providers on import and lists them', () => {
    expect(hasProvider('google-sheets')).toBe(true);
    expect(getProvider('google-sheets')).toBe(googleSheetsProvider);
    expect(listProviders().map((p) => p.id)).toContain('google-sheets');
  });

  it('skips duplicate provider registration', () => {
    const before = listProviders().length;
    registerProvider(googleSheetsProvider);
    expect(listProviders().length).toBe(before);
  });

  it('initializeProviders is idempotent', async () => {
    await initializeProviders();
    const providers = listProviders();
    await initializeProviders();
    expect(listProviders().length).toBe(providers.length);
  });
});
