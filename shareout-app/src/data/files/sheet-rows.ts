/**
 * One spreadsheet tab → row objects keyed by the header row, for data an artifact reads
 * as a dataset (the Drive-file sync job). Same input guards as the importers
 * (import-office.ts): byte cap, zip-bomb bound, row cap. SheetJS loads lazily.
 */
import { XLSX_MAX_INPUT_BYTES } from './parse-xlsx';
import { assertZipWithinBounds } from './unzip-bounded';

export const SHEET_ROWS_MAX = 100_000;

export class SheetRowsError extends Error {
  constructor(public code: 'TOO_LARGE' | 'UNREADABLE' | 'SHEET_NOT_FOUND' | 'EMPTY', message: string) {
    super(message);
  }
}

export interface SheetRows {
  sheet: string;
  sheets: string[];
  rows: Record<string, unknown>[];
}

/** Dates become ISO strings (date-only at midnight) so the dataset is plain JSON. */
function cell(v: unknown): unknown {
  if (!(v instanceof Date)) return v;
  if (Number.isNaN(v.getTime())) return null;
  const iso = v.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

/** `wanted` = a tab name (exact, then case-insensitive); empty = the first tab with cells. */
export async function sheetRows(bytes: Uint8Array, wanted?: string): Promise<SheetRows> {
  if (bytes.byteLength > XLSX_MAX_INPUT_BYTES) {
    throw new SheetRowsError('TOO_LARGE', `Spreadsheets up to ${XLSX_MAX_INPUT_BYTES / 1_000_000} MB can be synced.`);
  }
  try { assertZipWithinBounds(bytes); } catch {
    throw new SheetRowsError('TOO_LARGE', 'This spreadsheet expands to more than 64 MB and cannot be synced.');
  }
  const XLSX = await import('xlsx');
  let wb: import('xlsx').WorkBook;
  try { wb = XLSX.read(bytes, { type: 'array', dense: true, cellDates: true, sheetRows: SHEET_ROWS_MAX + 1 }); } catch {
    throw new SheetRowsError('UNREADABLE', 'This spreadsheet could not be read.');
  }
  const sheets = wb.SheetNames;
  const want = (wanted || '').trim();
  const name = want
    ? sheets.find((s) => s === want) ?? sheets.find((s) => s.trim().toLowerCase() === want.toLowerCase())
    : sheets.find((s) => wb.Sheets[s]?.['!ref']);
  if (!name) {
    if (want) throw new SheetRowsError('SHEET_NOT_FOUND', `No tab named "${want}". Tabs: ${sheets.join(', ')}.`);
    throw new SheetRowsError('EMPTY', 'This spreadsheet is empty.');
  }
  const sheet = wb.Sheets[name];
  const ref = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
  if (ref && ref.e.r >= SHEET_ROWS_MAX) {
    throw new SheetRowsError('TOO_LARGE', `"${name}" has more than ${SHEET_ROWS_MAX.toLocaleString('en')} rows.`);
  }
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true, blankrows: false });
  const rows = raw.map((r) => {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(r)) o[k] = cell(r[k]);
    return o;
  });
  return { sheet: name, sheets, rows };
}
