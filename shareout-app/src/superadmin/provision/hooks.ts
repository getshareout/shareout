/**
 * Extension points for provisioning steps whose features ship on their own.
 *
 * Custom domains ship as a built-in hook (builtin-hooks.ts), used when nothing is
 * registered here. `registerProvisionHook('custom_domain', fn)` overrides it (tests, or an instance that seeds workspaces differently). A hook that
 * cannot act yet reports `pending` with the manual next step.
 *
 * A hook must be idempotent: provisioning re-runs the whole spec on every call.
 */
import type { Env } from '../../types';

export type ProvisionHookName = 'custom_domain';

export interface ProvisionHookContext {
  env: Env;
  workspace: { id: string; slug: string; name: string };
  actor: { id: string; email: string };
  executionCtx?: ExecutionContext;
}

export interface ProvisionHookResult {
  status: 'created' | 'updated' | 'unchanged' | 'pending';
  detail?: Record<string, unknown>;
  next_step?: string;
}

export type ProvisionHook = (ctx: ProvisionHookContext, value: string) => Promise<ProvisionHookResult>;

const hooks = new Map<ProvisionHookName, ProvisionHook>();

export function registerProvisionHook(name: ProvisionHookName, hook: ProvisionHook): void {
  hooks.set(name, hook);
}

export function getProvisionHook(name: ProvisionHookName): ProvisionHook | undefined {
  return hooks.get(name);
}

/** Test seam: forget a registered hook. */
export function clearProvisionHook(name: ProvisionHookName): void {
  hooks.delete(name);
}
