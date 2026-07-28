import type { Env } from '../types';

// D1-compatible client over the per-artifact MiniDB Durable Object (ADR 28).
// Exposes the prepare().bind().first()/all()/run() subset the json/table handlers
// use, so they read ctx.db without knowing the backend is a DO.

export interface MiniStatement {
  bind(...args: unknown[]): MiniStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta: { changes: number } }>;
}

export interface MiniBatchStatement {
  sql: string;
  bindings?: unknown[];
  mode?: 'first' | 'all' | 'run';
}

export type MiniBatchResult = { result?: unknown; results?: unknown[]; meta?: { changes: number } };

export interface MiniDb {
  prepare(sql: string): MiniStatement;
  // One DO round-trip for N statements, run in a single transaction (ADR 28 / opt-001).
  batch(statements: MiniBatchStatement[]): Promise<MiniBatchResult[]>;
}

// Repository seam (ADR 28 §3): the default plane resolves a DO per artifact. An
// enterprise workspace can later be pinned to an isolated namespace here — a routing
// decision, not a code fork.
export function getMiniDbStub(env: Env, artifactId: string, _workspaceId: string): DurableObjectStub {
  return env.MINIDB.get(env.MINIDB.idFromName(artifactId));
}

export function createMiniDb(env: Env, artifactId: string, workspaceId: string): MiniDb {
  // Stub resolved lazily so requests that never touch the mini-store (and tests for
  // them) don't require the MINIDB binding.
  async function exec(sql: string, bindings: unknown[], mode: 'first' | 'all' | 'run'): Promise<{ result?: unknown; results?: unknown[]; meta?: { changes: number } }> {
    const stub = getMiniDbStub(env, artifactId, workspaceId);
    const res = await stub.fetch('https://minidb/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId },
      body: JSON.stringify({ sql, bindings, mode }),
    });
    if (!res.ok) throw new Error(`MiniDB error ${res.status}`);
    return res.json();
  }

  return {
    async batch(statements: MiniBatchStatement[]): Promise<MiniBatchResult[]> {
      const stub = getMiniDbStub(env, artifactId, workspaceId);
      const res = await stub.fetch('https://minidb/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId },
        body: JSON.stringify({ batch: statements }),
      });
      if (!res.ok) throw new Error(`MiniDB error ${res.status}`);
      const json = (await res.json()) as { results?: MiniBatchResult[] };
      return json.results ?? [];
    },
    prepare(sql: string): MiniStatement {
      let binds: unknown[] = [];
      const stmt: MiniStatement = {
        bind(...args: unknown[]) {
          binds = args;
          return stmt;
        },
        async first<T>() {
          const r = await exec(sql, binds, 'first');
          return (r.result ?? null) as T | null;
        },
        async all<T>() {
          const r = await exec(sql, binds, 'all');
          return { results: (r.results ?? []) as T[] };
        },
        async run() {
          const r = await exec(sql, binds, 'run');
          return { success: true, meta: r.meta ?? { changes: 0 } };
        },
      };
      return stmt;
    },
  };
}
