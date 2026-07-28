// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { zipSync, strToU8 } from 'fflate';
import { parseXlsx } from '../../../src/data/files/parse-xlsx';
import { parsePptx } from '../../../src/data/files/parse-pptx';
import { summarizeFile } from '../../../src/data/files';

function makeXlsx(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'Amount', 'When'],
    ['Alice', 42, new Date('2024-06-01')],
    ['Bob', 17, new Date('2024-06-02')],
    ['Carol', 99, new Date('2024-06-03')],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sales');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

function makePptx(slides: { title: string; body: string }[]): ArrayBuffer {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  };
  slides.forEach((s, i) => {
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] = strToU8(
      `<p:sld><p:txBody><a:p><a:t>${s.title}</a:t></a:p><a:p><a:t>${s.body}</a:t></a:p></p:txBody></p:sld>`,
    );
  });
  return zipSync(files).buffer as ArrayBuffer;
}

describe('parseXlsx', () => {
  it('returns headers, inferred types, row count, and sample rows', () => {
    const sheets = parseXlsx(makeXlsx());
    expect(sheets).toHaveLength(1);
    const s = sheets[0];
    expect(s.name).toBe('Sales');
    expect(s.headers).toEqual(['Name', 'Amount', 'When']);
    expect(s.rowCount).toBe(3);
    expect(s.sampleRows).toHaveLength(3);
    expect(s.columnTypes[0]).toBe('string');
    expect(s.columnTypes[1]).toBe('number');
    expect(s.columnTypes[2]).toBe('date');
  });

  it('rejects spreadsheets over the input cap', () => {
    const big = new ArrayBuffer(9_000_000);
    expect(() => parseXlsx(big)).toThrow(/too large/i);
  });
});

describe('parsePptx', () => {
  it('extracts slide titles and body lines from a:t runs', () => {
    const slides = parsePptx(makePptx([
      { title: 'Intro', body: 'Welcome aboard' },
      { title: 'Metrics', body: 'Revenue up 12%' },
    ]));
    expect(slides).toHaveLength(2);
    expect(slides[0]).toMatchObject({ index: 1, title: 'Intro', lines: ['Welcome aboard'] });
    expect(slides[1]).toMatchObject({ index: 2, title: 'Metrics', lines: ['Revenue up 12%'] });
  });
});

describe('summarizeFile', () => {
  it('caps text output at ~16KB', () => {
    const big = 'x'.repeat(20_000);
    const out = summarizeFile(new TextEncoder().encode(big).buffer, 'notes.txt', 'text/plain');
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain('[truncated]');
  });

  it('summarizes xlsx with sheet schema and sample rows', () => {
    const out = summarizeFile(makeXlsx(), 'ventas.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(out).toContain('Spreadsheet ventas.xlsx');
    expect(out).toContain('Sheet "Sales"');
    expect(out).toContain('Columns:');
    expect(out).toContain('Alice');
  });
});
