// @vitest-environment happy-dom
//
// New → "Table from an Excel file", as a person without an assistant meets it: pick a file, a bad
// one says what to do (with the button that does it), a good one opens the table and offers the
// three ways to keep it up to date — email first, one tap, already pointed at the table's data.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_new_menu_JS as newMenuJs } from '../../../src/pages/home/render-workspace/client-script/new-menu';
import { workspace_client_inspector_automate_JS as automateJs } from '../../../src/pages/home/render-workspace/client-script/inspector-automate';
import { workspace_client_home_views_modalsForms_JS as modalsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/modals-forms';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

let locale: 'en' | 'es' = 'es';
const t = (k: string) => (HOME_COPY[locale] as Record<string, string>)[k] ?? k;
const esc = (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

let fetchMock: ReturnType<typeof vi.fn>;
const opened: unknown[][] = [];
const panels: Array<[string, { id: string; name: string }]> = [];
const toasts: Array<[string, string]> = [];
const closed: string[] = [];
let picker: HTMLInputElement | null = null;

function load() {
  const win = globalThis.window as unknown as Record<string, unknown>;
  const extra: Record<string, unknown> = {
    fetch: (...a: unknown[]) => fetchMock(...a),
    showToast: (m: string, kind: string) => { toasts.push([m, kind]); return { close: () => { closed.push(m); } }; },
    openArtifact: (...a: unknown[]) => { opened.push(a); },
    openEmailSync: (art: { id: string; name: string }) => { panels.push(['email', art]); },
    openDriveSync: (art: { id: string; name: string }) => { panels.push(['drive', art]); },
    openSheetLinkSync: (art: { id: string; name: string }) => { panels.push(['link', art]); },
    locTag: () => (locale === 'es' ? 'es-AR' : 'en-US'),
    isvg: (p: string) => `<svg>${p}</svg>`,
    autoCache: {},
  };
  const scope = new Proxy({} as Record<string | symbol, unknown>, {
    has: () => true,
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop in extra) return extra[prop];
      if (prop === 'window') return win;
      if (prop === 'document') return document;
      if (prop === 't') return t;
      if (prop === 'esc') return esc;
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
    set: (target, prop, value) => { target[prop as string] = value; return true; },
  });
  new Function('scope', `with (scope) {\n${modalsJs}\n${automateJs}\n${newMenuJs}\n}`)(scope);
}

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
const modal = () => document.querySelector('.wsx-modal');

async function pick(file: File) {
  (document.getElementById('wsxNewBtn') as HTMLButtonElement).click();
  (document.querySelector('[data-new="table"]') as HTMLButtonElement).click();
  expect(picker).not.toBeNull();
  expect(picker!.accept).toBe('.xlsx,.csv');
  Object.defineProperty(picker!, 'files', { value: [file], configurable: true });
  picker!.dispatchEvent(new Event('change'));
  await flush();
}

beforeEach(() => {
  locale = 'es';
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_demo';
  win.__SO_HOME_LOCALE = () => locale;
  document.body.innerHTML = '<button id="wsxNewBtn" aria-expanded="false"></button><div id="wsxNewMenu" hidden></div>';
  opened.length = 0; panels.length = 0; toasts.length = 0; closed.length = 0; picker = null;
  vi.restoreAllMocks();
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) { if (this.type === 'file') picker = this; });
  fetchMock = vi.fn(async () => json({ ok: true, artifactId: 'art_t1', slug: 'ventas-abc123', name: 'ventas', rowCount: 365, columns: 3, sheet: 'Ventas' }));
  load();
});

describe('New → Tabla desde un Excel', () => {
  it('a good file: sends it, opens the table, says it worked, and offers email first', async () => {
    await pick(new File(['producto,unidades\nCafé,10\n'], 'ventas.csv', { type: 'text/csv' }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/v1/home/new?workspace=wsp_demo');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ template: 'table', lang: 'es', file: { name: 'ventas.csv' } });
    expect(atob(body.file.content)).toBe('producto,unidades\nCafé,10\n'.replace('é', 'Ã©'));
    expect(opened).toEqual([['ventas-abc123', 'ventas', 'art_t1']]);
    expect(toasts[0]).toEqual([t('new.tableCreating'), 'info']);
    expect(closed).toEqual([t('new.tableCreating')]); // "Armando tu tabla…" goes away once it is done

    const m = modal()!;
    expect(m.querySelector('.wsx-modal__head')!.textContent).toContain('¿La mantenemos al día?');
    expect(m.querySelector('[data-nt-done]')!.textContent).toBe('✓ Listo: tu tabla tiene 365 filas de “ventas.csv”.');
    const tiles = [...m.querySelectorAll('[data-aauto]')].map((b) => b.getAttribute('data-aauto'));
    expect(tiles).toEqual(['emailsync', 'drivesync', 'sheetlink']);
    expect(m.querySelector('[data-aauto="emailsync"]')!.textContent).toContain('Mandando el Excel por email');
    expect(m.textContent).not.toMatch(/dataset|job|página/i);
    // How to keep it up to date, step by step, in Spanish.
    expect(m.querySelector('[data-nt-guide]')!.getAttribute('href')).toBe(t('new.keepGuideUrl'));
    expect(t('new.keepGuideUrl')).toMatch(/^https:\/\/docs\.shareout\.site\/es\//);

    (m.querySelector('[data-aauto="emailsync"]') as HTMLButtonElement).click();
    expect(modal()).toBeNull();
    expect(panels).toEqual([['email', { id: 'art_t1', name: 'ventas' }]]);
  });

  it('"Ahora no" just closes; Drive and a link open their own panels', async () => {
    await pick(new File(['a\n1\n'], 'a.csv'));
    (modal()!.querySelector('[data-nt-later]') as HTMLButtonElement).click();
    expect(modal()).toBeNull();
    expect(panels).toEqual([]);
    await pick(new File(['a\n1\n'], 'a.csv'));
    (modal()!.querySelector('[data-aauto="drivesync"]') as HTMLButtonElement).click();
    expect(panels[0][0]).toBe('drive');
  });

  it('not a spreadsheet: says what to do before uploading anything, and "Elegir otro archivo" opens the picker again', async () => {
    await pick(new File(['%PDF'], 'informe.pdf'));
    expect(fetchMock).not.toHaveBeenCalled();
    const m = modal()!;
    expect(m.textContent).toContain('No se puede usar este archivo');
    expect(m.querySelector('[data-nt-err]')!.textContent).toBe('“informe.pdf” no es un Excel (.xlsx) ni un CSV. Abrilo en Excel, guardalo como .xlsx (Archivo → Guardar como) y elegilo de nuevo.');
    picker = null;
    (m.querySelector('[data-nt-again]') as HTMLButtonElement).click();
    expect(modal()).toBeNull();
    expect(picker).not.toBeNull();
  });

  it('too big: says the limit and what to do, without uploading', async () => {
    const big = new File(['x'], 'enorme.xlsx');
    Object.defineProperty(big, 'size', { value: 9_000_000 });
    await pick(big);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(modal()!.querySelector('[data-nt-err]')!.textContent).toBe('“enorme.xlsx” es demasiado grande (el límite es 8 MB). Dejá solo la pestaña que necesitás, o guardalo como CSV, y probá de nuevo.');
  });

  it('a file the server cannot use: shows its sentence, opens nothing', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 'NO_ROWS', error: '“vacio.xlsx” no tiene filas debajo de los títulos.' }, 422));
    await pick(new File(['x'], 'vacio.xlsx'));
    expect(opened).toEqual([]);
    expect(modal()!.querySelector('[data-nt-err]')!.textContent).toBe('“vacio.xlsx” no tiene filas debajo de los títulos.');
  });

  it('outside a workspace there is nothing to keep it updated with: the table opens with a toast', async () => {
    locale = 'en';
    (globalThis.window as unknown as Record<string, unknown>).WSX_WS = '';
    await pick(new File(['a\n1\n'], 'one.csv'));
    expect(fetchMock.mock.calls[0][0]).toBe('/v1/home/new');
    expect(modal()).toBeNull();
    expect(toasts.at(-1)).toEqual(['Your table is ready: 365 rows from “one.csv”.', 'success']);
  });
});
