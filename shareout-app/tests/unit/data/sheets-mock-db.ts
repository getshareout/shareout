/**
 * In-memory D1 mock for Google Sheets handler unit tests.
 *
 * Mirrors the subset of tables/queries used by `src/data/sheets/handler.ts`:
 * artifacts, sheet_syncs, artifact_tables, artifact_rows,
 * artifact_json (sheet cache), the artifact's Sheets connection row, and sheets_sync_log.
 */
import { vi } from 'vitest';
import type { Env } from '../../../src/types';

/** Stable artifact id used across all sheets handler tests. */
export const SHEETS_TEST_ARTIFACT_ID = 'art_test';

export const SHEETS_TEST_BASE_URL = 'https://shareout.example.com';
export const SHEETS_TEST_CREDENTIALS_KEY = 'test-credentials-key-32-chars!!';
export const SHEETS_TEST_SESSION_SECRET = 'session-secret-for-tests';
export const SHEETS_TEST_SPREADSHEET_ID = 'sheet_abc123456789012345';

export interface SheetConnectionRow {
  id: string;
  artifact_id: string;
  name: string;
  spreadsheet_id: string;
  sheet_name: string | null;
  target_table: string;
  sync_direction: string;
  sync_schedule: string | null;
  last_synced_at: string | null;
  row_count: number;
  created_at: string;
  updated_at: string;
}

export interface ArtifactTableRow {
  id: string;
  artifact_id: string;
  name: string;
  row_count?: number;
}

export interface ArtifactRowRecord {
  id: string;
  table_id: string;
  data: string;
  created_at?: string;
}

// The artifact's Sheets OAuth grant is a `connections` row: one blob holding the
// access and refresh tokens together, one iv.
export interface ArtifactTokenRow {
  artifact_id: string;
  encrypted_credentials: string;
  iv: string;
  expires_at: string;
}

export interface SheetsDbState {
  ownerId?: string | null;
  connections: SheetConnectionRow[];
  tables: ArtifactTableRow[];
  rows: ArtifactRowRecord[];
  artifactJson: Map<string, string>;
  artifactTokens: Map<string, ArtifactTokenRow>;
  syncLogs: Array<Record<string, unknown>>;
}

export function createSheetsDbState(overrides: Partial<SheetsDbState> = {}): SheetsDbState {
  return {
    ownerId: 'usr_owner',
    connections: [],
    tables: [],
    rows: [],
    artifactJson: new Map(),
    artifactTokens: new Map(),
    syncLogs: [],
    ...overrides,
  };
}

export const sampleSheetConnection: SheetConnectionRow = {
  id: 'gsc_existing',
  artifact_id: SHEETS_TEST_ARTIFACT_ID,
  name: 'sales',
  spreadsheet_id: SHEETS_TEST_SPREADSHEET_ID,
  sheet_name: 'Q1',
  target_table: 'sales_data',
  sync_direction: 'import',
  sync_schedule: null,
  last_synced_at: null,
  row_count: 0,
  created_at: '2026-05-30T12:00:00.000Z',
  updated_at: '2026-05-30T12:00:00.000Z',
};

export function findSheetConnection(state: SheetsDbState, artifactId: string, name: string) {
  return state.connections.find((c) => c.artifact_id === artifactId && c.name === name);
}

function dbFirst(sql: string, args: unknown[], state: SheetsDbState): unknown {
  if (sql.includes('owner_id FROM artifacts')) {
    return state.ownerId ? { owner_id: state.ownerId } : { owner_id: null };
  }
  if (sql.includes('SELECT id FROM artifacts WHERE id = ?')) {
    return args[0] === SHEETS_TEST_ARTIFACT_ID ? { id: SHEETS_TEST_ARTIFACT_ID } : null;
  }
  if (sql.includes('SELECT 1 FROM connections')) {
    return state.artifactTokens.has(args[0] as string) ? { 1: 1 } : null;
  }
  if (sql.includes('FROM connections')) {
    return state.artifactTokens.get(args[0] as string) ?? null;
  }
  if (sql.includes('sheet_syncs WHERE artifact_id = ? AND name = ?')) {
    if (sql.includes('SELECT id FROM')) {
      const conn = findSheetConnection(state, args[0] as string, args[1] as string);
      return conn ? { id: conn.id } : null;
    }
    if (sql.includes('SELECT * FROM')) {
      return findSheetConnection(state, args[0] as string, args[1] as string) ?? null;
    }
    if (sql.includes('DELETE FROM')) {
      const idx = state.connections.findIndex(
        (c) => c.artifact_id === args[0] && c.name === args[1],
      );
      if (idx === -1) return null;
      const removed = state.connections.splice(idx, 1)[0];
      return { id: removed.id };
    }
  }
  if (sql.includes('SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?')) {
    const table = state.tables.find(
      (t) => t.artifact_id === args[0] && t.name === args[1],
    );
    return table ? { id: table.id } : null;
  }
  if (sql.includes('SELECT value FROM artifact_json')) {
    const key = args[1] as string;
    const value = state.artifactJson.get(`${args[0]}::${key}`);
    return value ? { value } : null;
  }
  if (sql.includes('FROM users WHERE id = ? AND email = ?')) {
    return args[0] === state.ownerId ? { id: args[0] } : null;
  }
  return null;
}

function dbAll(sql: string, args: unknown[], state: SheetsDbState): unknown[] {
  if (sql.includes('FROM sheet_syncs')) {
    return state.connections
      .filter((c) => c.artifact_id === args[0])
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  if (sql.includes('SELECT data FROM artifact_rows WHERE table_id = ?')) {
    return state.rows
      .filter((r) => r.table_id === args[0])
      .map((r) => ({ data: r.data }));
  }
  if (sql.includes('FROM artifact_json') && sql.includes('json_extract(value')) {
    const artifactId = args[0] as string;
    const results: Array<{ key: string; cachedAt: string; rowCount: number }> = [];
    for (const [compoundKey, value] of state.artifactJson.entries()) {
      if (!compoundKey.startsWith(`${artifactId}::`)) continue;
      const key = compoundKey.slice(`${artifactId}::`.length);
      if (!key.startsWith('_sheets_cache_')) continue;
      try {
        const parsed = JSON.parse(value);
        results.push({
          key,
          cachedAt: parsed.cachedAt,
          rowCount: parsed.data?.rowCount ?? 0,
        });
      } catch {
        // ignore malformed cache entries
      }
    }
    return results.sort((a, b) => a.key.localeCompare(b.key));
  }
  return [];
}

function dbRun(sql: string, args: unknown[], state: SheetsDbState): void {
  if (sql.includes('INSERT INTO sheet_syncs')) {
    const [
      id, artifactId, name, spreadsheetId, sheetName,
      targetTable, syncDirection, syncSchedule, createdAt, updatedAt,
    ] = args as string[];
    state.connections.push({
      id,
      artifact_id: artifactId,
      name,
      spreadsheet_id: spreadsheetId,
      sheet_name: sheetName,
      target_table: targetTable,
      sync_direction: syncDirection,
      sync_schedule: syncSchedule,
      last_synced_at: null,
      row_count: 0,
      created_at: createdAt,
      updated_at: updatedAt,
    });
    return;
  }
  if (sql.includes('INSERT INTO sheets_sync_log')) {
    state.syncLogs.push({
      id: args[0],
      connection_id: args[1],
      direction: args[2] === 'import' || args[2] === 'export' ? args[2] : sql.includes("'import'") ? 'import' : 'export',
      status: 'running',
      started_at: args[args.length - 1],
    });
    return;
  }
  if (sql.includes('UPDATE sheets_sync_log')) {
    const log = state.syncLogs.find((l) => l.id === args[3]);
    if (log) {
      log.status = args[0];
      log.rows_affected = args[1];
      log.error_message = args[2];
    }
    return;
  }
  if (sql.includes('INSERT INTO artifact_tables')) {
    state.tables.push({
      id: args[0] as string,
      artifact_id: args[1] as string,
      name: args[2] as string,
      row_count: 0,
    });
    return;
  }
  if (sql.includes('DELETE FROM artifact_rows WHERE table_id = ?') && !sql.includes('AND id')) {
    const tableId = args[0] as string;
    state.rows = state.rows.filter((r) => r.table_id !== tableId);
    return;
  }
  if (sql.includes('INSERT INTO artifact_rows')) {
    state.rows.push({
      id: args[0] as string,
      table_id: args[1] as string,
      data: args[2] as string,
      created_at: new Date().toISOString(),
    });
    return;
  }
  if (sql.includes('UPDATE artifact_tables SET row_count')) {
    const table = state.tables.find((t) => t.id === args[1]);
    if (table) table.row_count = args[0] as number;
    return;
  }
  if (sql.includes('UPDATE sheet_syncs')) {
    const conn = state.connections.find((c) => c.id === args[1]);
    if (conn) {
      conn.row_count = args[0] as number;
      conn.last_synced_at = new Date().toISOString();
    }
    return;
  }
  if (sql.includes('INSERT INTO artifact_json') || sql.includes('ON CONFLICT(artifact_id, key)')) {
    const [, artifactId, key, value] = args as [string, string, string, string];
    state.artifactJson.set(`${artifactId}::${key}`, value);
    return;
  }
  if (sql.includes('DELETE FROM artifact_json')) {
    const artifactId = args[0] as string;
    if (args.length === 1 && sql.includes("key LIKE '_sheets_cache_%'")) {
      for (const compoundKey of [...state.artifactJson.keys()]) {
        if (compoundKey.startsWith(`${artifactId}::_sheets_cache_`)) {
          state.artifactJson.delete(compoundKey);
        }
      }
      return;
    }
    const pattern = args[1] as string | undefined;
    if (!pattern) return;
    for (const compoundKey of [...state.artifactJson.keys()]) {
      if (!compoundKey.startsWith(`${artifactId}::`)) continue;
      const key = compoundKey.slice(`${artifactId}::`.length);
      if (pattern.endsWith('%')) {
        const prefix = pattern.slice(0, -1);
        if (key.startsWith(prefix)) state.artifactJson.delete(compoundKey);
      } else if (key === pattern) {
        state.artifactJson.delete(compoundKey);
      }
    }
    return;
  }
  if (sql.includes('INSERT INTO connections')) {
    // (id, scope_id, name, encrypted_credentials, iv, expires_at)
    const [, artifactId, , encrypted, iv, expiresAt] = args as [string, string, string, string, string, string];
    state.artifactTokens.set(artifactId, {
      artifact_id: artifactId,
      encrypted_credentials: encrypted,
      iv,
      expires_at: expiresAt,
    });
  }
}

/** Build a minimal Env whose D1 binding reads/writes the given in-memory state. */
export function makeSheetsTestEnv(state: SheetsDbState = createSheetsDbState()): Env {
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => dbFirst(sql, args, state)),
        all: vi.fn(async () => ({ results: dbAll(sql, args, state) })),
        run: vi.fn(async () => {
          dbRun(sql, args, state);
          return { success: true, meta: { changes: 1 } };
        }),
      })),
    })),
    batch: vi.fn(async () => [{ success: true }]),
  } as unknown as Env['DB'];

  return {
    DB,
    SESSION_SECRET: SHEETS_TEST_SESSION_SECRET,
    CREDENTIALS_KEY: SHEETS_TEST_CREDENTIALS_KEY,
    SHAREOUT_BASE_URL: SHEETS_TEST_BASE_URL,
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
  } as Env;
}
