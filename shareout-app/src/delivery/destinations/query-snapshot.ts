import type { Destination, DeliveryStep } from '../types';
import type { QuerySnapshotConfig } from '../../scheduling/jobs';
import { runMaterialize } from '../../data/materialize';
import { queryConnectionAny } from '../../data/connections/warehouse-query';

// Generic, deterministic data refresh: run a configured list of queries against a
// workspace connection (REST or a warehouse like BigQuery, on the artifact owner's
// credentials) and write each result into the artifact store. Fixed SQL lives in
// config — no agent authors it — so dashboards get a reliable daily snapshot.
export const querySnapshotDestination: Destination<QuerySnapshotConfig> = {
  kind: 'query_snapshot',

  async validate(_env, _ctx, config) {
    if (!config?.connection) return 'query_snapshot requires a connection name';
    if (!Array.isArray(config?.queries) || config.queries.length === 0) {
      return 'query_snapshot requires a non-empty queries[]';
    }
    for (const q of config.queries) {
      if (!q?.query) return 'each entry in queries[] needs a "query"';
      if (!q?.target?.type || !q?.target?.name) return 'each entry in queries[] needs target { type, name }';
      if (!['dataset', 'table', 'json'].includes(q.target.type)) return 'target.type must be dataset, table, or json';
    }
    return null;
  },

  async deliver(env, ctx, config) {
    const steps: DeliveryStep[] = [];
    try {
      const art = await env.DB.prepare('SELECT owner_id FROM artifacts WHERE id = ?')
        .bind(ctx.artifactId).first<{ owner_id: string | null }>();
      const userId = art?.owner_id || ctx.createdBy;
      const options = config.params ? { params: config.params } : undefined;

      for (const q of config.queries) {
        const target = `${q.target.type}:${q.target.name}`;
        const t0 = Date.now();
        try {
          const res = await runMaterialize(
            env,
            ctx.artifactId,
            { source: { connection: config.connection, query: q.query, options }, target: q.target, mode: q.mode },
            (c, query, p) => queryConnectionAny(env, ctx.artifactId, c, query, p, userId)
          );
          steps.push({
            step: 'fetch',
            status: 'success',
            durationMs: Date.now() - t0,
            detail: { connection: config.connection, target, rowCount: res.rowCount },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'query failed';
          steps.push({
            step: 'fetch',
            status: 'failed',
            durationMs: Date.now() - t0,
            detail: { connection: config.connection, target, error: message },
          });
          return { success: false, error: `${target}: ${message}`, steps };
        }
      }
      return { success: true, steps };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'query_snapshot failed', steps };
    }
  },
};
