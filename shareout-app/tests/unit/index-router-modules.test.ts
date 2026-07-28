// @vitest-environment node
/**
 * Structural guard for the index-router test decomposition (2026-07-23).
 * Ensures the monolithic index-router.test.ts stays split into focused modules.
 */
import { describe, expect, it } from 'vitest';

const routerSuites = import.meta.glob('./index-router/suites/*.ts');
const routerSupport = import.meta.glob('./index-router/{handlers,fixtures}.ts', { eager: true });

const EXPECTED_SUITES = [
  'account-auth.ts',
  'artifact-serving.ts',
  'browser-auth-sdk.ts',
  'cors-preflight.ts',
  'data-api.ts',
  'enterprise-routes.ts',
  'health-fallthrough.ts',
  'jobs-proxy-landing.ts',
  'publish-artifacts.ts',
  'scheduled-cron.ts',
  'subdomain-routing.ts',
  'workspaces-folders.ts',
].sort();

describe('index-router test module layout', () => {
  it('loads 12 focused suite modules (no monolithic index-router.test.ts)', () => {
    const names = Object.keys(routerSuites).map((p) => p.split('/').pop()!).sort();
    expect(names).toEqual(EXPECTED_SUITES);
    expect(names).not.toContain('index-router.test.ts');
  });

  it('includes handlers and fixtures support modules', () => {
    expect(Object.keys(routerSupport)).toEqual(
      expect.arrayContaining([
        './index-router/handlers.ts',
        './index-router/fixtures.ts',
      ]),
    );
    expect(Object.keys(routerSuites).length).toBe(12);
  });

  it('exports fetch helpers from fixtures', async () => {
    const fixtures = await import('./index-router/fixtures');
    expect(fixtures.APEX).toBe('https://shareout.example.com');
    expect(typeof fixtures.createEnv).toBe('function');
  });
});
