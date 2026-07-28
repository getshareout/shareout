/** Artifact table storage limits — enforced on every write path. */
export const MAX_TABLES_PER_ARTIFACT = 50;
export const MAX_ROWS_PER_TABLE = 100_000;
export const MAX_ROW_SIZE = 100_000;
export const MAX_QUERY_LIMIT = 1000;
export const MAX_FIELD_NAME_LENGTH = 64;
export const TABLE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
