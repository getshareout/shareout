/**
 * Shared Vitest mocks for artifact serve handler integration tests.
 *
 * Import this module at the top of every `serve/*.test.ts` file (before handler
 * imports) so auth, analytics, and access-request side effects stay stubbed.
 */
import { vi } from 'vitest';

vi.mock('../../../../src/artifacts/access-requests', () => ({
  getPendingAccessRequest: vi.fn(async () => null),
}));

vi.mock('../../../../src/auth', () => ({
  getSessionUser: vi.fn(async () => null),
  verifyAccessToken: vi.fn(async () => false),
  loginPage: vi.fn((slug: string, name: string) =>
    new Response(`login:${slug}:${name}`, { status: 401, headers: { 'Content-Type': 'text/html' } })
  ),
  accessDeniedPage: vi.fn((opts: { slug: string; artifactName: string }) =>
    new Response(`denied:${opts.slug}:${opts.artifactName}`, { status: 403, headers: { 'Content-Type': 'text/html' } })
  ),
  passwordLoginPage: vi.fn((slug: string, name: string) =>
    new Response(`password:${slug}:${name}`, { status: 401 })
  ),
  credentialsLoginPage: vi.fn((slug: string, name: string) =>
    new Response(`credentials:${slug}:${name}`, { status: 401 })
  ),
}));

vi.mock('../../../../src/analytics', () => ({
  trackPageView: vi.fn(async () => undefined),
}));

vi.mock('../../../../src/view-tracking', () => ({
  trackViewerView: vi.fn(async () => undefined),
}));
