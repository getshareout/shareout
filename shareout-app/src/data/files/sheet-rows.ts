/**
 * One spreadsheet tab → row objects keyed by the header row, for data an artifact reads
 * as a dataset (the Drive-file sync job). Same input guards as the importers
 * (import-office.ts): byte cap, zip-bomb bound, row cap. SheetJS loads lazily.
 */
import { XLSX_MAX_INPUT_BYTES } from './parse-xlsx';
import { assertZipWithinBounds } from './unzip-bounded';
import { sha256 } from '../../crypto-utils';

export const SHEET_ROWS_MAX = 100_000;

export class SheetRowsError extends Error {
  constructor(
    public code: 'TOO_LARGE' | 'TOO_MANY_ROWS' | 'UNREADABLE' | 'SHEET_NOT_FOUND' | 'EMPTY',
    message: string,
    /** The workbook's tabs, on SHEET_NOT_FOUND. */
    public sheets: string[] = [],
  ) {
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

/** A CSV written by a Spanish (or other comma-decimal) Excel separates fields with ";" and writes
 *  1,5 for one and a half and 1.234 for a thousand-odd. SheetJS reads "1,5" as 15, so such a file is
 *  read as text and its numbers converted here. Decided by the first line: more ";" than ",". */
function semicolonCsv(text: string): boolean {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const bare = first.replace(/"[^"]*"/g, '');
  const semis = (bare.match(/;/g) || []).length;
  return semis > 0 && semis > (bare.match(/,/g) || []).length;
}

const DECIMAL_COMMA = /^-?\d+(,\d+)?(%)?$/;
const GROUPED = /^-?\d{1,3}(\.\d{3})+(,\d+)?(%)?$/;
const DOT_DECIMAL = /^-?\d+\.\d+(%)?$/;

/** "1,5" → 1.5, "1.234,5" → 1234.5, "12%" → 0.12; anything else stays as written. */
export function commaDecimalCell(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t) return null;
  let n: string | null = null;
  if (GROUPED.test(t)) n = t.replace(/\./g, '').replace(',', '.');
  else if (DECIMAL_COMMA.test(t)) n = t.replace(',', '.');
  else if (DOT_DECIMAL.test(t)) n = t;
  if (n === null) return v;
  const pct = n.endsWith('%');
  const num = Number(pct ? n.slice(0, -1) : n);
  return Number.isFinite(num) ? (pct ? num / 100 : num) : v;
}

function utf8(bytes: Uint8Array): string | null {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^﻿/, ''); } catch { return null; }
}

/** Same tab + same rows → same key, so a sync can skip a write that changes nothing. Dataset
 *  metadata is readable by the page's viewers: the key says nothing about where the rows came from. */
export async function sheetRowsKey(sheet: string, rows: unknown[]): Promise<string> {
  const hex = await sha256(new TextEncoder().encode(`${sheet}\n${JSON.stringify(rows)}`).buffer as ArrayBuffer);
  return hex.slice(0, 32);
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
  // SheetJS reads a text file without a BOM as Windows-1252 ("José" → "JosÃ©"). Text that is valid
  // UTF-8 goes in as a string; anything else (zip, legacy binary, Latin-1 CSV) stays as bytes.
  const text = bytes[0] === 0x50 && bytes[1] === 0x4b ? null : utf8(bytes);
  const opts = { dense: true, cellDates: true, sheetRows: SHEET_ROWS_MAX + 1 } as const;
  const commaDecimals = text !== null && semicolonCsv(text);
  try { wb = text !== null ? XLSX.read(text, { ...opts, type: 'string', ...(commaDecimals ? { raw: true } : {}) }) : XLSX.read(bytes, { ...opts, type: 'array' }); } catch {
    throw new SheetRowsError('UNREADABLE', 'This spreadsheet could not be read.');
  }
  const sheets = wb.SheetNames;
  const want = (wanted || '').trim();
  const name = want
    ? sheets.find((s) => s === want) ?? sheets.find((s) => s.trim().toLowerCase() === want.toLowerCase())
    : sheets.find((s) => wb.Sheets[s]?.['!ref']);
  if (!name) {
    if (want) throw new SheetRowsError('SHEET_NOT_FOUND', `No tab named "${want}". Tabs: ${sheets.join(', ')}.`, sheets);
    throw new SheetRowsError('EMPTY', 'This spreadsheet is empty.');
  }
  const sheet = wb.Sheets[name];
  const ref = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
  if (ref && ref.e.r >= SHEET_ROWS_MAX) {
    throw new SheetRowsError('TOO_MANY_ROWS', `"${name}" has more than ${SHEET_ROWS_MAX.toLocaleString('en')} rows.`);
  }
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true, blankrows: false });
  const rows = raw.map((r) => {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(r)) o[k] = commaDecimals ? commaDecimalCell(r[k]) : cell(r[k]);
    return o;
  });
  return { sheet: name, sheets, rows };
}
