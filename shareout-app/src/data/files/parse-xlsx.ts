import * as XLSX from 'xlsx';

const MAX_INPUT_BYTES = 8_000_000; // ponytail: parse cap; stream/partial parse if users hit it
const SAMPLE_ROWS = 20;

export interface SheetSummary {
  name: string;
  headers: string[];
  columnTypes: string[];
  rowCount: number;
  sampleRows: unknown[][];
}

function inferType(values: unknown[]): string {
  const present = values.filter(v => v !== null && v !== undefined && v !== '');
  if (!present.length) return 'empty';
  if (present.every(v => typeof v === 'number')) return 'number';
  if (present.every(v => v instanceof Date)) return 'date';
  if (present.every(v => typeof v === 'boolean')) return 'boolean';
  return 'string';
}

export function parseXlsx(bytes: ArrayBuffer): SheetSummary[] {
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`Spreadsheet too large to read (max ${MAX_INPUT_BYTES / 1_000_000}MB)`);
  }
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true, dense: true });
  return wb.SheetNames.map(name => {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null }) as unknown[][];
    const headers = (rows[0] || []).map(h => String(h ?? ''));
    const body = rows.slice(1);
    const sampleRows = body.slice(0, SAMPLE_ROWS);
    const columnTypes = headers.map((_, i) => inferType(sampleRows.map(r => r[i])));
    return { name, headers, columnTypes, rowCount: body.length, sampleRows };
  });
}
