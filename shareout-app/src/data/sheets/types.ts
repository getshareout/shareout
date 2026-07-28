export interface SheetConnection {
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

export interface SpreadsheetData {
  values: string[][];
}

export interface SheetConnectionSummary {
  name: string;
  spreadsheetId: string;
  sheetName: string | null;
  targetTable: string;
  syncDirection: string;
  syncSchedule: string | null;
  lastSyncedAt: string | null;
  rowCount: number;
  createdAt: string;
}
