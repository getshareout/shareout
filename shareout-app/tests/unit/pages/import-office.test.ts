// Office → artifact conversion on import: Word → Markdown (+ images), workbook → CSV per sheet.
import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { ImportError, convertOfficeImport, docxToMarkdown, workbookToCsvSheets, MAX_SHEET_ROWS } from '../../../src/pages/home/import-office';
import { importArtifactType, importDestination } from '../../../src/pages/home/import-rules';
import { parseMarkdown } from '../../../src/viewers/markdown-viewer';
import { DOCX_MARKDOWN, PNG_1PX, docxFixture, toBase64, xlsxFixture } from '../helpers/office-fixtures';
import { REAL_DOC, REAL_DOC_TEXT } from '../helpers/doc-fixtures';

const env = {} as Env;

describe('import classifier: read it → artifact, build with it → Recursos', () => {
  it.each([
    ['page.html', 'artifact'], ['page.HTM', 'artifact'], ['ventas.csv', 'artifact'], ['notes.md', 'artifact'],
    ['notes.markdown', 'artifact'], ['data.json', 'artifact'], ['readme.txt', 'artifact'], ['deck.pdf', 'artifact'],
    ['plan.docx', 'artifact'], ['plan.odt', 'artifact'], ['book.xlsx', 'artifact'], ['old.xls', 'artifact'], ['calc.ods', 'artifact'],
    ['photo.png', 'assets'], ['photo.JPG', 'assets'], ['logo.svg', 'assets'], ['clip.mp4', 'assets'], ['song.mp3', 'assets'],
    ['font.woff2', 'assets'], ['slides.pptx', 'assets'], ['archive.zip', 'assets'], ['noext', 'assets'], ['x.constructor', 'assets'],
  ])('%s → %s', (name, dest) => {
    expect(importDestination(name)).toBe(dest);
  });

  it('maps Office files onto viewer types', () => {
    expect(importArtifactType('plan.docx')).toBe('markdown');
    expect(importArtifactType('book.xlsx')).toBe('csv');
  });
});

describe('docxToMarkdown', () => {
  it('converts headings, inline formatting, links, nested lists, tables and images', () => {
    const { markdown, media } = docxToMarkdown(docxFixture());
    expect(markdown).toBe(DOCX_MARKDOWN);
    expect(media).toEqual([{ path: 'media/image1.png', content: toBase64(PNG_1PX), mime: 'image/png', encoding: 'base64' }]);
  });

  it('renders cleanly in the Markdown viewer', () => {
    const html = parseMarkdown(docxToMarkdown(docxFixture()).markdown);
    expect(html).toContain('<h1 id="quarterly-plan">Quarterly plan</h1>');
    expect(html).toContain('<ol><li>Hire two people</li><li>Ship the app<ul><li>iOS first</li><li>Then Android</li></ul></li><li>Celebrate</li></ol>');
    expect(html).toContain('<table><thead><tr><th>Region</th><th>Sales</th></tr></thead>');
    expect(html).toContain('<img src="media/image1.png" alt="Logo">');
  });

  it('rejects a file that is not a Word document', () => {
    expect(() => docxToMarkdown(new Uint8Array([1, 2, 3]))).toThrow(ImportError);
  });
});

describe('workbookToCsvSheets', () => {
  it('turns every non-empty sheet into CSV, in order', () => {
    const sheets = workbookToCsvSheets(xlsxFixture({ 'Q1 2024': [['Region', 'Sales'], ['North', 120]], Empty: [], Team: [['Name'], ['Ana, B.']] }));
    expect(sheets).toEqual([{ name: 'Q1 2024', csv: 'Region,Sales\nNorth,120' }, { name: 'Team', csv: 'Name\n"Ana, B."' }]);
  });

  it('refuses a workbook over the in-Worker parse cap before reading it', () => {
    try { workbookToCsvSheets(new Uint8Array(8_000_001)); throw new Error('no throw'); } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      expect(e).toMatchObject({ code: 'SPREADSHEET_TOO_LARGE', status: 413 });
    }
  });

  it('refuses a sheet with too many rows to view', () => {
    const rows = Array.from({ length: MAX_SHEET_ROWS + 2 }, (_, i) => [i]);
    expect(() => workbookToCsvSheets(xlsxFixture({ Big: rows }))).toThrow(/more than/);
  });
});

describe('convertOfficeImport', () => {
  it('Word → one .md entrypoint + images + the original', async () => {
    const out = await convertOfficeImport(env, 'Plan Q3.docx', 'docx', 'word', docxFixture());
    expect(out.entrypoint).toBe('Plan Q3.md');
    expect(out.files.map((f) => f.path)).toEqual(['Plan Q3.md', 'media/image1.png', 'original/Plan Q3.docx']);
    expect(out.files[0]).toMatchObject({ content: DOCX_MARKDOWN, mime: 'text/markdown' });
    expect(out.files[2]).toMatchObject({ encoding: 'base64', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(out.source).toEqual({ original: 'original/Plan Q3.docx' });
  });

  it('workbook → one CSV per sheet (first is the entrypoint) + the original', async () => {
    const out = await convertOfficeImport(env, 'book.xlsx', 'xlsx', 'sheet', xlsxFixture({ 'Q1 (draft)': [['a'], [1]], Team: [['b'], [2]] }));
    expect(out.entrypoint).toBe('sheets/01-Q1 -draft.csv');
    expect(out.files.map((f) => f.path)).toEqual(['sheets/01-Q1 -draft.csv', 'sheets/02-Team.csv', 'original/book.xlsx']);
    expect(out.source).toEqual({ original: 'original/book.xlsx', sheets: [{ name: 'Q1 (draft)', path: 'sheets/01-Q1 -draft.csv' }, { name: 'Team', path: 'sheets/02-Team.csv' }] });
  });

  it('.odt needs Workers AI; without it the error says what to do', async () => {
    await expect(convertOfficeImport(env, 'a.odt', 'odt', 'word', new Uint8Array([1]))).rejects.toMatchObject({ code: 'CONVERT_UNAVAILABLE' });
  });

  it('legacy Word .doc → Markdown paragraphs in-Worker, original kept', async () => {
    expect(importArtifactType('old.doc')).toBe('markdown');
    const out = await convertOfficeImport(env, 'Procedimiento.doc', 'doc', 'word', REAL_DOC());
    expect(out.entrypoint).toBe('Procedimiento.md');
    expect(out.files[0].content).toBe(REAL_DOC_TEXT);
    expect(out.files.find((f) => f.path === 'original/Procedimiento.doc')).toMatchObject({ mime: 'application/msword', encoding: 'base64' });
    await expect(convertOfficeImport(env, 'bad.doc', 'doc', 'word', new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'CONVERT_FAILED', message: 'This .doc file could not be opened.' });
  });

  it('.odt converts through Workers AI toMarkdown when present', async () => {
    const ai = { toMarkdown: async () => ({ format: 'markdown', data: '# From odt\n' }) };
    const out = await convertOfficeImport({ AI: ai } as unknown as Env, 'a.odt', 'odt', 'word', new Uint8Array([1]));
    expect(out.files.map((f) => f.path)).toEqual(['a.md', 'original/a.odt']);
  });
});
