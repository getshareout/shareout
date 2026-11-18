// @vitest-environment happy-dom
//
// The table page New → "Table from an Excel file" publishes, run in a browser-like DOM with the
// page SDK stubbed: whatever the file holds — markup, a formula, a script-looking column title —
// shows as the text it is, never as HTML.
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTableHtml } from '../../../src/pages/home/new-table';

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

async function render(rows: Record<string, unknown>[], columns?: string[]) {
  const html = buildTableHtml({ title: 'Ventas', lang: 'es', dataset: 'datos' });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const script = Array.from(doc.querySelectorAll('script')).find((s) => !s.getAttribute('src'))!.textContent || '';
  doc.querySelectorAll('script').forEach((s) => s.remove()); // the SDK is stubbed below
  document.body.innerHTML = doc.body.innerHTML;
  (globalThis as Record<string, unknown>).ShareOut = {
    create: async () => ({
      dataset: (name: string) => {
        expect(name).toBe('datos');
        return {
          get: async () => rows,
          metadata: async () => ({ metadata: columns ? { columns } : {}, updatedAt: new Date().toISOString() }),
        };
      },
    }),
  };
  new Function(script)();
  await flush();
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('the table page shows what the file holds as text', () => {
  it('a cell with HTML, a formula or a script tag is shown as written, and creates no element', async () => {
    const cols = ['<i>Cliente</i>', 'Nota', 'Fórmula', 'Importe'];
    await render([
      { '<i>Cliente</i>': 'Peñarol <img src=x onerror="window.__pwned=1">', Nota: '<b>x</b>', 'Fórmula': '=SUM(A1:A2)', Importe: 1234.5 },
      { '<i>Cliente</i>': 'Ñandú', Nota: '<script>window.__pwned=1</script>', 'Fórmula': '=HYPERLINK("http://x","y")', Importe: 0.25 },
    ], cols);

    const body = document.getElementById('rows')!;
    expect(body.querySelectorAll('tr')).toHaveLength(2);
    expect(body.querySelectorAll('b, i, img, script')).toHaveLength(0);
    expect(document.getElementById('head')!.querySelectorAll('i')).toHaveLength(0);

    const cells = Array.from(body.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent));
    expect(cells[0][0]).toBe('Peñarol <img src=x onerror="window.__pwned=1">');
    expect(cells[0][1]).toBe('<b>x</b>');
    expect(cells[0][2]).toBe('=SUM(A1:A2)');
    expect(cells[1][1]).toBe('<script>window.__pwned=1</script>');
    expect(cells[1][2]).toBe('=HYPERLINK("http://x","y")');
    expect(Array.from(document.querySelectorAll('#head th')).map((th) => th.textContent)).toEqual(cols);
    expect(body.querySelector('td')!.getAttribute('data-label')).toBe('<i>Cliente</i>');
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('accents survive and decimals read in the person’s language', async () => {
    await render([{ Producto: 'Café con leche', Precio: 1234.5 }, { Producto: 'Ñoquis', Precio: 0.25 }]);
    const cells = Array.from(document.querySelectorAll('#rows td')).map((td) => td.textContent);
    expect(cells[0]).toBe('Café con leche');
    expect(cells[2]).toBe('Ñoquis');
    expect(cells[3]).toBe(new Intl.NumberFormat('es', { maximumFractionDigits: 6 }).format(0.25));
    expect(cells[3]).toBe('0,25');
    expect(document.getElementById('meta')!.textContent).toContain('2 filas');
  });
});
