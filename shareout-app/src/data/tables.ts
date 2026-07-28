/**
 * Backward-compatible re-exports for the artifact tables data tier.
 * Implementation lives in `./tables/` — see `handler.ts` for the module map.
 */
export {
  handleTables,
  buildScopeClause,
  filterToSql,
  queryRowsForTool,
  listTableNames,
  insertRowsForTool,
  updateRowsForTool,
  writeTableRows,
  botInsertRows,
  botUpdateRowById,
  botUpdateRowsByFilter,
} from './tables/handler';
export type { QueryBody, Filter, QueryResult } from './tables/types';
