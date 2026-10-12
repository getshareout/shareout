import { waitUntil } from 'cloudflare:workers';

// A KV miss goes to central storage (~250 ms from far colos, with multi-second tails);
// past this budget the caller's D1 fallback is faster than waiting.
const KV_READ_BUDGET_MS = 500;

/** Read-through cache lookup that treats a slow KV read as a miss. */
export async function kvCacheGet(kv: KVNamespace, key: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      kv.get(key),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), KV_READ_BUDGET_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Run best-effort work (cache fills, metadata writes) after the response instead of before it. */
export function deferWork(work: () => Promise<unknown>): void {
  const settled = (async () => work())().catch(() => {});
  try {
    waitUntil(settled);
  } catch {
    // No request context (tests, some DO paths): the promise still runs.
  }
}
