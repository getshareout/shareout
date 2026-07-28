// Test double for the MINIDB Durable Object namespace: translates the DO exec
// protocol ({sql, bindings, mode}) back into a D1-style prepare().bind().first/all/run
// mock, so existing SQL-dispatch mocks drive the per-artifact mini-store path.
interface D1ish {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first(): Promise<unknown>;
      all(): Promise<{ results: unknown[] }>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
}

export function miniDbBinding(dbOrGetter: D1ish | (() => D1ish)) {
  const resolve = () => (typeof dbOrGetter === 'function' ? dbOrGetter() : dbOrGetter);
  return {
    idFromName: () => 'do-id',
    get: () => ({
      fetch: async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        const runOne = async ({ sql, bindings = [], mode = 'all' }: { sql: string; bindings?: unknown[]; mode?: 'first' | 'all' | 'run' }) => {
          const stmt = resolve().prepare(sql).bind(...bindings);
          if (mode === 'first') return { result: (await stmt.first()) ?? null };
          if (mode === 'run') return { meta: (await stmt.run()).meta };
          return { results: (await stmt.all()).results };
        };
        if (body.batch) {
          const results = [];
          for (const s of body.batch) results.push(await runOne(s));
          return Response.json({ results });
        }
        return Response.json(await runOne(body));
      },
    }),
  };
}
