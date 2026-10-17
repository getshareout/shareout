/** What every step of a run works with, and the token wrapper they share. */
import type { Env } from '../types';
import type { ProviderApi, WalkLimits } from './types';
import type { RunRow, SourceRow } from './runs';
import { accessTokenFor, type ConnectionRow } from './connections';
import { AuthExpiredError } from './http';

export interface Active {
  env: Env;
  run: RunRow;
  source: SourceRow;
  conn: ConnectionRow;
  api: ProviderApi;
  limits: WalkLimits;
}

/** Call the provider with a fresh token, refreshing once on a 401. */
export async function withToken<T>(a: Active, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await accessTokenFor(a.env, a.conn));
  } catch (e) {
    if (!(e instanceof AuthExpiredError)) throw e;
    return fn(await accessTokenFor(a.env, a.conn, true));
  }
}

