import type { MaterializeConfig } from '../../scheduling/jobs';
import { runMaterialize } from '../../data/materialize';
import { queryConnectionAny } from '../../data/connections/warehouse-query';
import type { Destination } from '../types';

export const materializeDestination: Destination<MaterializeConfig> = {
  kind: 'materialize',

  async validate(_env, _ctx, config) {
    if (!config.connection) return 'Materialize requires a connection name';
    if (!config.target?.type || !config.target?.name) return 'Materialize requires target { type, name }';
    if (config.target.type !== 'dataset' && config.target.type !== 'table') {
      return 'target.type must be "dataset" or "table"';
    }
    return null;
  },

  async deliver(env, ctx, config) {
    try {
      await runMaterialize(
        env,
        ctx.artifactId,
        {
          source: { connection: config.connection, query: config.query, options: config.options },
          target: config.target,
          mode: config.mode,
          format: config.format,
        },
        (conn, query, p) => queryConnectionAny(env, ctx.artifactId, conn, query, p, ctx.createdBy)
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Materialize failed' };
    }
  },
};
