// New → "Table from an Excel file": POST /v1/home/new { template: 'table', file }. The real parser
// (sheetRows) and the real page scanner; publishing, limits and the dataset write are stubbed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { Env } from '../../../src/types';

const hostWorkspaceId = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
const publishGeneratedHtml = vi.hoisted(() => vi.fn());
const checkRateLimit = vi.hoisted(() => vi.fn());
const incrementRateLimit = vi.hoisted(() => vi.fn());
const checkStorageQuota = vi.hoisted(() => vi.fn());
const writeDatasetRows = vi.hoisted(() => vi.fn());

vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));
vi.mock('../../../src/publish/publish-generated-html', () => ({ publishGeneratedHtml }));
vi.mock('../../../src/api-auth', () => ({ checkRateLimit, incrementRateLimit, RATE_LIMIT_MAX: 100 }));
vi.mock('../../../src/quota', () => ({ checkStorageQuota }));
vi.mock('../../../src/data/datasets/handler', async (orig) => ({ ...(await orig<object>()), writeDatasetRows }));

import { handleHomeNewArtifactApi } from '../../../src/pages/home/new-artifact';
import { TABLE_DATASET, buildTableHtml, tableTitle } from '../../../src/pages/home/new-table';
import { scanPage } from '../../../src/provenance/scan';
import { suggestDataset } from '../../../src/email/email-sync-status';

const env = {} as Env;
const user = { id: 'usr_1', email: 'laura@example.com' };
const post = (body: unknown, qs = '') =>
  handleHomeNewArtifactApi(new Request(`https://shareout.site/v1/home/new${qs}`, { method: 'POST', body: JSON.stringify(body) }), env, user);

function xlsx(rows: unknown[][], tab = 'Ventas'): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), tab);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
const b64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const file = (name: string, bytes: Uint8Array) => ({ name, content: b64(bytes) });
const table = (f: unknown, lang = 'es', qs = '') => post({ template: 'table', lang, file: f }, qs);

beforeEach(() => {
  hostWorkspaceId.mockReset().mockResolvedValue('wsp_demo');
  getInternalWorkspaceRole.mockReset().mockResolvedValue('member');
  publishGeneratedHtml.mockReset().mockResolvedValue({ artifact: { id: 'art_t1' }, deployment: { slug: 'ventas-noviembre-abc123' } });
  checkRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 99, reset: 0 });
  incrementRateLimit.mockReset().mockResolvedValue(undefined);
  checkStorageQuota.mockReset().mockResolvedValue({ allowed: true, used: 0, incoming: 0, max: 0 });
  writeDatasetRows.mockReset().mockImplementation(async (_e, _a, name, format, rows) => ({ name, format, version: 1, sizeBytes: 1, rowCount: rows.length }));
});

describe('POST /v1/home/new — table from an Excel file', () => {
  it('turns the first tab into the page’s data and publishes a private table page in the workspace', async () => {
    const res = await table(file('Ventas_noviembre.xlsx', xlsx([['Producto', 'Unidades', 'Fecha'], ['Café', 10, new Date(Date.UTC(2026, 10, 3))], ['Té', 4, null]])));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, artifactId: 'art_t1', slug: 'ventas-noviembre-abc123', name: 'Ventas noviembre', rowCount: 2, columns: 3, sheet: 'Ventas' });
    const opts = publishGeneratedHtml.mock.calls[0][2];
    expect(opts).toMatchObject({ visibility: 'private', workspaceId: 'wsp_demo', name: 'Ventas noviembre' });
    expect(opts.slug).toMatch(/^ventas-noviembre-[0-9a-f]{6}$/);
    expect(opts.html).toContain('<html lang="es">');
    expect(opts.html).toContain('sdk.dataset("datos")');
    const [, artifactId, name, format, rows, extra] = writeDatasetRows.mock.calls[0];
    expect([artifactId, name, format]).toEqual(['art_t1', 'datos', 'json']);
    expect(rows).toEqual([{ Producto: 'Café', Unidades: 10, Fecha: '2026-11-03' }, { Producto: 'Té', Unidades: 4, Fecha: null }]);
    expect(extra.source).toMatchObject({ provider: 'upload', file: 'Ventas_noviembre.xlsx', sheet: 'Ventas' });
    expect(incrementRateLimit).toHaveBeenCalledOnce();
  });

  it('reads a CSV written by a Spanish Excel (; and decimal commas) and names it in English for an English speaker', async () => {
    const res = await table(file('stock.csv', new TextEncoder().encode('producto;precio\nCafé;1,5\nMate;1.234,5\n')), 'en');
    expect(res.status).toBe(200);
    expect(writeDatasetRows.mock.calls[0][2]).toBe('data');
    expect(writeDatasetRows.mock.calls[0][4]).toEqual([{ producto: 'Café', precio: 1.5 }, { producto: 'Mate', precio: 1234.5 }]);
    expect(publishGeneratedHtml.mock.calls[0][2].html).toContain('sdk.dataset("data")');
  });

  it('refuses a file it cannot use with one sentence saying what to do, and creates nothing', async () => {
    const cases: Array<[unknown, number, string, RegExp]> = [
      [undefined, 400, 'NO_FILE', /^Elegí un archivo Excel/],
      [file('informe.pdf', new TextEncoder().encode('%PDF-1.4')), 400, 'NOT_A_SHEET', /“informe\.pdf” no es un Excel .* guardalo como \.xlsx/],
      [file('ventas.xlsx', new TextEncoder().encode('no soy un zip')), 400, 'NOT_A_SHEET', /no es un Excel/],
      [file('ventas.csv', new TextEncoder().encode('<html><body>hola</body></html>')), 400, 'NOT_A_SHEET', /no es un Excel/],
      [file('vacio.xlsx', xlsx([['Producto', 'Unidades']])), 422, 'NO_ROWS', /no tiene filas debajo de los títulos/],
      [file('vacio.csv', new TextEncoder().encode('producto,unidades\n')), 422, 'NO_ROWS', /La primera fila lleva los títulos/],
      [{ name: 'grande.xlsx', content: 'A'.repeat(11_000_000) }, 413, 'TOO_LARGE', /demasiado grande \(el límite es 8 MB\)/],
    ];
    for (const [f, status, code, re] of cases) {
      const res = await table(f);
      expect(res.status, code).toBe(status);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe(code);
      expect(body.error).toMatch(re);
      expect(body.error).not.toMatch(/página|dataset|job/i);
    }
    expect(publishGeneratedHtml).not.toHaveBeenCalled();
    expect(writeDatasetRows).not.toHaveBeenCalled();
    expect(incrementRateLimit).not.toHaveBeenCalled();
  });

  it('keeps the gates of every New item: membership, the publish limit, the storage cap', async () => {
    getInternalWorkspaceRole.mockResolvedValueOnce(null);
    expect((await table(file('a.csv', new TextEncoder().encode('a\n1\n')))).status).toBe(403);
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, reset: Math.floor(Date.now() / 1000) + 60 });
    expect((await table(file('a.csv', new TextEncoder().encode('a\n1\n')))).status).toBe(429);
    checkStorageQuota.mockResolvedValueOnce({ allowed: false, used: 10, incoming: 1, max: 10 });
    expect((await table(file('a.csv', new TextEncoder().encode('a\n1\n')))).status).toBe(413);
    expect(publishGeneratedHtml).not.toHaveBeenCalled();
  });

  it('says so when the page was made but its rows could not be saved', async () => {
    writeDatasetRows.mockRejectedValueOnce(new Error('quota'));
    const res = await table(file('a.csv', new TextEncoder().encode('a\n1\n')), 'en');
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'WRITE_FAILED', artifactId: 'art_t1', slug: 'ventas-noviembre-abc123', error: expect.stringMatching(/Try again in a minute/) });
  });
});

describe('the table page', () => {
  it('reads exactly one dataset, so “Update by email” is pointed at it without asking', async () => {
    for (const lang of ['es', 'en'] as const) {
      const scan = await scanPage(buildTableHtml({ title: 'Ventas', lang, dataset: TABLE_DATASET[lang] }), 'index.html');
      const reads = [...scan.code.datasets];
      expect(reads).toEqual([TABLE_DATASET[lang]]);
      expect(suggestDataset(reads, [])).toBe(TABLE_DATASET[lang]);
    }
  });

  it('escapes the title, never lets a file name close the script, and has the empty state and phone layout', () => {
    const html = buildTableHtml({ title: '<img src=x onerror=alert(1)></script>', lang: 'es', dataset: 'datos' });
    expect(html).not.toContain('<img src=x');
    expect(html.match(/<\/script>/g)).toHaveLength(2); // the SDK tag and the page's own script, nothing injected
    expect(html).toContain('Todavía no hay datos');
    expect(html).toContain('Cuando llegue el Excel, la tabla aparece acá.');
    expect(html).toContain('@media (max-width:640px)');
    expect(html).toContain('content:attr(data-label)');
    expect(html).toContain('td.textContent = show(');
    expect(html).toContain('ds.page({ offset: rows.length, limit: 10000 })'); // no direct file serving: page by page
    expect(html).not.toMatch(/innerHTML/);
    expect(html).not.toMatch(/página/i);
  });

  it('takes its title from the file name', () => {
    expect(tableTitle('C:\\Users\\ana\\Ventas_del_mes.xlsx', 'es')).toBe('Ventas del mes');
    expect(tableTitle('.csv', 'es')).toBe('Tabla');
    expect(tableTitle('.xlsx', 'en')).toBe('Table');
  });
});
