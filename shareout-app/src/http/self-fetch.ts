// In-process dispatch through this Worker's own router. A subrequest to the Worker's own
// zone fails with Cloudflare 522, so code that must call this deployment's API hands the
// Request to the router directly.
//
// The entry module registers the router (src/index.ts; tests/worker-main.ts in tests)
// instead of product code importing it. A product module that imports the router, even
// lazily, closes an import cycle through a large part of src/, and vitest's related-test
// mapping (npm run test:affected) then selects over half the suite for a change to any
// module in that cycle. check:boundaries enforces this.
import type { Env } from '../types';

export type SelfFetch = (request: Request, env: Env, ctx?: ExecutionContext) => Promise<Response>;

let router: SelfFetch | null = null;

/** Registers the router. The Worker entry calls this at startup; tests pass a stub, or null to clear. */
export function setSelfFetch(fn: SelfFetch | null): void {
  router = fn;
}

/** Dispatches `request` through the registered router. Throws when no entry registered one. */
export function selfFetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (!router) {
    throw new Error('selfFetch: no router registered. The Worker entry must call setSelfFetch(handleFetch).');
  }
  return router(request, env, ctx);
}
