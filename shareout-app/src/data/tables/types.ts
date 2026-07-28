/** Mongo-style filter operators supported by table queries. */
export type FilterOperator = {
  $eq?: unknown;
  $ne?: unknown;
  $gt?: unknown;
  $gte?: unknown;
  $lt?: unknown;
  $lte?: unknown;
  $in?: unknown[];
  $nin?: unknown[];
  $contains?: string;
  $startsWith?: string;
  $endsWith?: string;
};

/** Client filter object: field → literal value or operator object. */
export type Filter = Record<string, unknown | FilterOperator>;

/** POST /tables/{name}/query body. */
export interface QueryBody {
  filter?: Filter;
  sort?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  skip?: number;
  select?: string[];
  /** When false, skip COUNT(*) and derive hasMore via LIMIT+1 probe. */
  count?: boolean;
}

/** Scoped query result shared by HTTP and Crew tools. */
export interface QueryResult {
  rows: Record<string, unknown>[];
  /** Omitted when count:false (SDK path). */
  total?: number;
  hasMore: boolean;
}
