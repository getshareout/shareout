import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import type { SeedOptions } from './index';

/**
 * Fire-and-forget seeding for signup / workspace-create paths. Runs past the
 * response via waitUntil when an ExecutionContext is available, so the user is
 * redirected immediately and the kit fills in within seconds. Never throws into
 * the caller — a seeding hiccup must not block account or workspace creation.
 */
export function scheduleSeedStarterKit(
  env: Env,
  user: AuthUser,
  opts: SeedOptions,
  executionCtx?: ExecutionContext,
): void {
  // Seeding runs past the response — it requires a waitUntil context. The Worker
  // fetch handler always supplies one; absence means a direct/unit-test call, so
  // we skip rather than block the caller with 10-15 inline publishes.
  if (!executionCtx?.waitUntil) return;
  const run = import('./index')
    .then(({ seedStarterKit }) => seedStarterKit(env, user, opts))
    .then((r) => {
      if (r.failed.length) {
        console.warn('starter-kit seed partial', user.id, opts.tier, r.failed);
      }
    })
    .catch((e) => console.error('starter-kit seed failed', user.id, e));
  executionCtx.waitUntil(run);
}
