import { parseXlsx } from './parse-xlsx';
import { parsePptx } from './parse-pptx';

// Context guard: everything the agent reads is capped — never dump a whole file
// into the model context.
const MAX_OUTPUT_CHARS = 16_000;

const SPREADSHEET_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
];
const PRESENTATION_MIMES = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
const TEXT_MIMES = ['text/plain', 'text/csv', 'text/markdown', 'application/json'];

function cap(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return text.slice(0, MAX_OUTPUT_CHARS) + '\n…[truncated]';
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** Render a file as agent-readable text: schema + sample, never the full payload. */
export function summarizeFile(bytes: ArrayBuffer, filename: string, mimeType: string): string {
  const lower = filename.toLowerCase();

  if (SPREADSHEET_MIMES.includes(mimeType) || lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const sheets = parseXlsx(bytes);
    const parts = sheets.map(s => {
      const header = `## Sheet "${s.name}" — ${s.rowCount} data rows`;
      const cols = s.headers
        .map((h, i) => `${h || `(col ${i + 1})`}: ${s.columnTypes[i]}`)
        .join(' | ');
      const rows = s.sampleRows.map(r => r.map(cell).join('\t')).join('\n');
      return `${header}\nColumns: ${cols}\nSample (first ${s.sampleRows.length} rows, tab-separated):\n${s.headers.join('\t')}\n${rows}`;
    });
    return cap(`Spreadsheet ${filename}, ${sheets.length} sheet(s).\n\n${parts.join('\n\n')}`);
  }

  if (PRESENTATION_MIMES.includes(mimeType) || lower.endsWith('.pptx')) {
    const slides = parsePptx(bytes);
    const parts = slides.map(s =>
      `## Slide ${s.index}: ${s.title}\n${s.lines.join('\n')}`.trim()
    );
    return cap(`Presentation ${filename}, ${slides.length} slide(s).\n\n${parts.join('\n\n')}`);
  }

  if (TEXT_MIMES.includes(mimeType) || /\.(csv|txt|md|json)$/.test(lower)) {
    return cap(new TextDecoder().decode(bytes));
  }

  return `Binary file ${filename} (${mimeType}, ${(bytes.byteLength / 1000).toFixed(0)}KB) — cannot be read as text.`;
}
