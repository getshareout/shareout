// @vitest-environment node
// Viewing imported Office files: every workbook sheet is reachable, and Download gives the original.
import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { serveTypeViewer } from '../../../src/serve/type-viewer';

const SOURCE = {
  original: 'original/book.xlsx',
  sheets: [{ name: 'Sales', path: 'sheets/01-Sales.csv' }, { name: 'Team & Co', path: 'sheets/02-Team & Co.csv' }],
};
const R2: Record<string, string> = { 'k/sales': 'Region,Total\nNorth,120\n', 'k/team': 'Name\nAna\n', 'k/plan': '# Plan\n\nHello.\n' };

function fakeEnv(): Env {
  const assets: Record<string, { r2_key: string; mime: string; size_bytes: number }> = {
    'sheets/02-Team & Co.csv': { r2_key: 'k/team', mime: 'text/csv', size_bytes: 10 },
  };
  let bound: unknown[] = [];
  const stmt = {
    bind: (...a: unknown[]) => { bound = a; return stmt; },
    first: async () => assets[String(bound[1])] ?? null,
    all: async () => ({ results: [] }),
    run: async () => ({}),
  };
  return {
    SHAREOUT_BASE_URL: 'https://shareout.test',
    ARTIFACTS: { get: async (k: string) => (R2[k] != null ? { text: async () => R2[k] } : null) },
    DB: { prepare: () => stmt, batch: async () => [] },
  } as unknown as Env;
}

function view(url: string, type: 'csv' | 'markdown', meta: unknown, entry: { key: string; path: string; mime: string }) {
  return serveTypeViewer(
    new Request(url),
    fakeEnv(),
    { artifact_id: 'art_1', artifact_type: type, artifact_name: 'Book', owner_id: 'u', visibility: 'private', workspace_id: null, version_id: 'ver_1', type_metadata: JSON.stringify(meta), entrypoint: entry.path } as never,
    { r2_key: entry.key, mime: entry.mime, size_bytes: 10 },
    'book',
    undefined as never,
  ).then((r) => r.text());
}

describe('imported workbook viewer', () => {
  const entry = { key: 'k/sales', path: 'sheets/01-Sales.csv', mime: 'text/csv' };

  it('shows the first sheet with a tab per sheet', async () => {
    const html = await view('https://shareout.test/a/book/', 'csv', { source: SOURCE }, entry);
    expect(html).toContain('North');
    expect(html).toContain('<a class="sheet-tab is-on" href="?sheet=1" aria-current="page">Sales</a>');
    expect(html).toContain('<a class="sheet-tab" href="?sheet=2">Team &amp; Co</a>');
  });

  it('shows the second sheet on ?sheet=2', async () => {
    const html = await view('https://shareout.test/a/book/?sheet=2', 'csv', { source: SOURCE }, entry);
    expect(html).toContain('Ana');
    expect(html).not.toContain('North');
    expect(html).toContain('<a class="sheet-tab is-on" href="?sheet=2" aria-current="page">Team &amp; Co</a>');
  });

  it('offers the original workbook for download', async () => {
    const html = await view('https://shareout.test/a/book/', 'csv', { source: SOURCE }, entry);
    expect(html).toContain('href="/a/book/original/book.xlsx" download="book.xlsx"');
    expect(html).toContain('Download original');
  });

  it('a single-sheet or plain CSV shows no tabs and the usual download', async () => {
    const html = await view('https://shareout.test/a/book/', 'csv', {}, entry);
    expect(html).not.toContain('class="sheet-tab');
    expect(html).not.toContain('Download original');
  });
});

describe('imported Word viewer', () => {
  it('renders the Markdown and downloads the original .docx', async () => {
    const html = await view('https://shareout.test/a/book/', 'markdown', { source: { original: 'original/Plan Q3.docx' } }, { key: 'k/plan', path: 'Plan Q3.md', mime: 'text/markdown' });
    expect(html).toContain('<h1 id="plan">Plan</h1>');
    expect(html).toContain('href="/a/book/original/Plan%20Q3.docx" download="Plan Q3.docx"');
  });
});

describe('imported PDF viewer: Text | Original tabs', () => {
  const pdf = { source: { original: 'original/Informe Rev.1.pdf' } };
  const md = { key: 'k/plan', path: 'Informe Rev.1.md', mime: 'text/markdown' };

  it('shows the text by default, with a tab to the original PDF', async () => {
    const html = await view('https://shareout.test/a/book/?wsx=1', 'markdown', pdf, md);
    expect(html).toContain('<h1');
    expect(html).not.toContain('<iframe class="original-pdf"');
    expect(html).toMatch(/class="doc-tab is-on" href="\?wsx=1"[^>]*>Text</);
    expect(html).toContain('href="?wsx=1&amp;show=original"');
  });

  it('?show=original shows the PDF inline instead of the text', async () => {
    const html = await view('https://shareout.test/a/book/?show=original', 'markdown', pdf, md);
    expect(html).toContain('<iframe class="original-pdf" src="/a/book/original/Informe%20Rev.1.pdf"');
    expect(html).not.toContain('<article class="content">');
    expect(html).toMatch(/class="doc-tab is-on" href="\?show=original"[^>]*>Original</);
  });

  it('a Word original gets no tabs (the browser cannot show it)', async () => {
    const html = await view('https://shareout.test/a/book/?show=original', 'markdown', { source: { original: 'original/Plan Q3.docx' } }, md);
    expect(html).not.toContain('<nav class="doc-tabs"');
    expect(html).not.toContain('<iframe class="original-pdf"');
  });
});
