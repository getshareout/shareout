/** What every step of a run works with, and the token wrapper they share. */
import type { Env } from '../types';
import type { ProviderApi, WalkLimits } from './types';
import type { RunRow, SourceRow } from './runs';
import { AuthExpiredError } from './http';

export interface Active {
  env: Env;
  run: RunRow;
  source: SourceRow;
  api: ProviderApi;
  limits: WalkLimits;
  /** Whose rights the run acts with: the connection's owner (OAuth) or the source's creator (shared folder). */
  actorId: string;
  /** A provider token: the member's consent, or the workspace's own service account. `force` skips the cache. */
  token: (force?: boolean) => Promise<string>;
  /** Shared-folder sources: the email the folder must stay shared with. */
  shareEmail?: string;
}

/** Call the provider with a fresh token, refreshing once on a 401. */
export async function withToken<T>(a: Active, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await a.token());
  } catch (e) {
    if (!(e instanceof AuthExpiredError)) throw e;
    return fn(await a.token(true));
  }
}
