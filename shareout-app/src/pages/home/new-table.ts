/**
 * New → "Table from an Excel file" (POST /v1/home/new { template: 'table', file }): the person picks
 * an .xlsx or .csv on their computer; its first tab becomes the page's data — through the same
 * bounded parser and dataset writer as the Drive and email syncs (sheetRows, writeDatasetRows) — and
 * a private page shows it as a table that reads well on a phone. The page reads its data by one
 * name, so "Update by email" is already pointed at it and never asks which data. A file that cannot
 * be used is refused before anything is created, with one sentence saying what to do.
 */
import type { Env } from '../../types';
import { escapeHtml } from '../../html/utils';
import { fonts } from '../../../packages/design-tokens/src/index';
import { incrementRateLimit } from '../../api-auth';
import { checkStorageQuota } from '../../quota';
import { publishGeneratedHtml } from '../../publish/publish-generated-html';
import { storageLimitMessage } from '../../publish/limits';
import { generateSlug } from '../../validation';
import { XLSX_MAX_INPUT_BYTES } from '../../data/files/parse-xlsx';
import { SHEET_ROWS_MAX, SheetRowsError, sheetRows } from '../../data/files/sheet-rows';
import { writeDatasetRows } from '../../data/datasets/handler';
import { looksLike } from '../../delivery/destinations/email-sheet-sync';
import { base64ToBytes } from './import-office';
import { TABLE_ERRORS as ERRORS, type TableErrorCode } from './new-table-copy';

type Lang = 'en' | 'es';

/** The name the page reads its rows by — the person never sees it. */
export const TABLE_DATASET: Record<Lang, string> = { en: 'data', es: 'datos' };

const STATUS: Record<TableErrorCode, number> = { NO_FILE: 400, NOT_A_SHEET: 400, TOO_LARGE: 413, TOO_MANY_ROWS: 413, NO_ROWS: 422, UNREADABLE: 422, WRITE_FAILED: 500 };

function tableError(lang: Lang, code: TableErrorCode, file = ''): Response {
  const error = ERRORS[lang][code].replace(/\{(\w+)\}/g, (_, k: string) => (
    k === 'file' ? file : k === 'mb' ? String(XLSX_MAX_INPUT_BYTES / 1_000_000) : k === 'rows' ? SHEET_ROWS_MAX.toLocaleString(lang) : ''
  ));
  return Response.json({ error, code }, { status: STATUS[code] });
}

// What the page says, in the person's language. {time} {date} {n} are filled in the browser.
const PAGE_COPY: Record<Lang, Record<string, string>> = {
  en: {
    loading: 'Loading the table…',
    failed: 'The table couldn’t load. Reload the page to try again.',
    emptyTitle: 'No data yet',
    emptyBody: 'When the Excel file arrives, the table shows up here.',
    waiting: 'Waiting for the first file.',
    updatedToday: 'Updated today at {time}',
    updatedYesterday: 'Updated yesterday at {time}',
    updatedOn: 'Updated on {date}',
    rows: '{n} rows',
    oneRow: '1 row',
    from: 'from {file}',
    search: 'Search the table',
    noMatch: 'No rows contain “{q}”.',
    matches: '{n} of {total} rows',
    more: 'Show {n} more rows',
    yes: 'Yes',
    no: 'No',
    note: 'The data comes from the last Excel file loaded. Its first row holds the column titles.',
  },
  es: {
    loading: 'Cargando la tabla…',
    failed: 'No se pudo cargar la tabla. Recargá para probar de nuevo.',
    emptyTitle: 'Todavía no hay datos',
    emptyBody: 'Cuando llegue el Excel, la tabla aparece acá.',
    waiting: 'Esperando el primer archivo.',
    updatedToday: 'Actualizado hoy a las {time}',
    updatedYesterday: 'Actualizado ayer a las {time}',
    updatedOn: 'Actualizado el {date}',
    rows: '{n} filas',
    oneRow: '1 fila',
    from: 'de {file}',
    search: 'Buscar en la tabla',
    noMatch: 'Ninguna fila tiene “{q}”.',
    matches: '{n} de {total} filas',
    more: 'Mostrar {n} filas más',
    yes: 'Sí',
    no: 'No',
    note: 'Los datos vienen del último Excel cargado. Su primera fila son los títulos de las columnas.',
  },
};

/** JSON safe to drop inside a <script>: no "</script>" can close it early. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * The table page: reads `dataset` with the page SDK, shows when it last changed in plain words, a
 * search box for long tables, 200 rows at a time, and a friendly empty state before the first file.
 * Under 640 px every row becomes a card (column title · value), so nothing scrolls sideways.
 * Cells are written with textContent: nothing in the file is ever treated as markup.
 */
export function buildTableHtml(opts: { title: string; lang: Lang; dataset: string }): string {
  const { title, lang, dataset } = opts;
  const c = PAGE_COPY[lang];
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fafaf9;--card:#ffffff;--ink:#1c1917;--muted:#57534e;--line:#e7e5e4;--head:#f5f5f4;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--card:#292524;--ink:#fafaf9;--muted:#a8a29e;--line:#44403c;--head:#231f1d;--accent:#60a5fa}}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink);font-family:${fonts.body};font-size:15px;line-height:1.5}
main{max-width:1100px;margin:0 auto;padding:32px 20px 64px}
h1{font-family:${fonts.display};font-size:28px;line-height:1.2;margin:0 0 6px;overflow-wrap:anywhere}
.meta{margin:0 0 20px;color:var(--muted);font-size:14px}
.search{display:block;width:100%;max-width:340px;margin:0 0 12px;font:inherit;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)}
.search:focus{outline:2px solid var(--accent);outline-offset:1px}
.box{overflow:auto;max-height:75vh;border:1px solid var(--line);border-radius:12px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
th{position:sticky;top:0;z-index:1;background:var(--head);font-weight:600;white-space:nowrap}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
.more{margin:12px 0 0;font:inherit;padding:9px 14px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);cursor:pointer}
.status{margin:12px 0 0;color:var(--muted)}
.empty{border:1px dashed var(--line);border-radius:12px;padding:48px 20px;text-align:center;color:var(--muted);background:var(--card)}
.empty b{display:block;margin-bottom:4px;color:var(--ink);font-size:17px}
.note{margin:20px 0 0;color:var(--muted);font-size:13px}
@media (max-width:640px){
main{padding:20px 14px 48px}
h1{font-size:24px}
.search{max-width:none}
.box{overflow:visible;max-height:none;border:0;border-radius:0;background:none}
table,tbody,tr,td{display:block;width:100%}
thead{display:none}
tr{margin:0 0 10px;padding:4px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
tbody tr:last-child td{border-bottom:1px solid var(--line)}
td,tbody tr td:last-child{display:flex;justify-content:space-between;gap:16px;padding:8px 0;text-align:right;white-space:normal;overflow-wrap:anywhere}
tbody tr td:last-child{border-bottom:0}
td::before{content:attr(data-label);flex:0 0 42%;color:var(--muted);font-weight:600;text-align:left}
}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="meta" id="meta" aria-live="polite">${escapeHtml(c.loading)}</p>
<input class="search" id="q" type="search" placeholder="${escapeHtml(c.search)}" aria-label="${escapeHtml(c.search)}" hidden>
<div class="box" id="box" hidden><table><thead><tr id="head"></tr></thead><tbody id="rows"></tbody></table></div>
<p class="status" id="status" hidden></p>
<button class="more" id="more" type="button" hidden></button>
<div class="empty" id="empty" hidden><b>${escapeHtml(c.emptyTitle)}</b>${escapeHtml(c.emptyBody)}</div>
<p class="note">${escapeHtml(c.note)}</p>
</main>
<script src="/sdk/shareout.js"></script>
<script>
(async function () {
  var T = ${scriptJson(c)}, LANG = ${scriptJson(lang)}, PAGE = 200;
  function el(id) { return document.getElementById(id); }
  function fill(s, v) { return s.replace(/\\{(\\w+)\\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }); }
  var meta = el('meta'), rows = [], info = null;
  try {
    var sdk = await ShareOut.create();
    var ds = sdk.dataset(${scriptJson(dataset)});
    try { rows = await ds.get(); } catch (e) {
      // An instance without direct file serving: read the rows page by page instead.
      rows = [];
      for (var pg = { hasMore: true }; pg.hasMore && rows.length < 200000;) {
        pg = await ds.page({ offset: rows.length, limit: 10000 });
        if (!pg.data || !pg.data.length) break;
        rows = rows.concat(pg.data);
      }
    }
    if (rows.length) { try { info = await ds.metadata(); } catch (e) { info = null; } }
  } catch (e) { meta.textContent = T.failed; return; }
  if (!rows.length) { meta.textContent = T.waiting; el('empty').hidden = false; return; }

  var md = (info && info.metadata) || {};
  var cols = Array.isArray(md.columns) && md.columns.length ? md.columns : Object.keys(rows[0]);
  var nf = new Intl.NumberFormat(LANG, { maximumFractionDigits: 6 });
  var ISO = /^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?Z?)?$/;
  function show(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return nf.format(v);
    if (typeof v === 'boolean') return v ? T.yes : T.no;
    if (typeof v === 'string' && ISO.test(v)) {
      var d = new Date(v.length === 10 ? v + 'T00:00:00Z' : v);
      if (!isNaN(d.getTime())) return v.length === 10 ? d.toLocaleDateString(LANG, { timeZone: 'UTC' }) : d.toLocaleString(LANG, { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' });
    }
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  // A column whose filled cells are all numbers lines up on the right.
  var numeric = cols.map(function (k) { var any = false; for (var i = 0; i < rows.length; i++) { var v = rows[i][k]; if (v == null || v === '') continue; if (typeof v !== 'number') return false; any = true; } return any; });
  // An Excel column with no title comes through as "__EMPTY": show it without one.
  var labels = cols.map(function (k) { return /^__EMPTY(_\\d+)?$/.test(k) ? '' : k; });

  function when(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    var time = d.toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' });
    var now = new Date(), y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === now.toDateString()) return fill(T.updatedToday, { time: time });
    if (d.toDateString() === y.toDateString()) return fill(T.updatedYesterday, { time: time });
    var opts = { day: 'numeric', month: 'long' }; if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return fill(T.updatedOn, { date: d.toLocaleDateString(LANG, opts) });
  }
  var count = rows.length === 1 ? T.oneRow : fill(T.rows, { n: nf.format(rows.length) });
  var file = md.source && md.source.file ? fill(T.from, { file: md.source.file }) : '';
  meta.textContent = [info && info.updatedAt ? when(info.updatedAt) : '', count + (file ? ' ' + file : '')].filter(Boolean).join(' \\u00b7 ');

  var head = el('head');
  labels.forEach(function (l, i) { var th = document.createElement('th'); th.textContent = l; if (numeric[i]) th.className = 'n'; th.scope = 'col'; head.appendChild(th); });
  var body = el('rows'), more = el('more'), status = el('status'), q = el('q');
  var shown = 0, list = rows;
  function paint(reset) {
    if (reset) { body.textContent = ''; shown = 0; }
    var end = Math.min(list.length, shown + PAGE), frag = document.createDocumentFragment();
    for (var i = shown; i < end; i++) {
      var tr = document.createElement('tr');
      for (var j = 0; j < cols.length; j++) {
        var td = document.createElement('td');
        td.textContent = show(list[i][cols[j]]);
        td.setAttribute('data-label', labels[j]);
        if (numeric[j]) td.className = 'n';
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    body.appendChild(frag); shown = end;
    var left = list.length - shown;
    more.hidden = left <= 0;
    more.textContent = fill(T.more, { n: nf.format(Math.min(PAGE, left)) });
    el('box').hidden = list.length === 0;
  }
  more.addEventListener('click', function () { paint(false); });
  if (rows.length > 10) {
    q.hidden = false;
    var text = rows.map(function (r) { return cols.map(function (k) { return show(r[k]); }).join(' \\u0001 ').toLowerCase(); });
    var timer = 0;
    q.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var needle = q.value.trim().toLowerCase();
        list = needle ? rows.filter(function (r, i) { return text[i].indexOf(needle) !== -1; }) : rows;
        status.hidden = !needle;
        status.textContent = !needle ? '' : list.length ? fill(T.matches, { n: nf.format(list.length), total: nf.format(rows.length) }) : fill(T.noMatch, { q: q.value.trim() });
        paint(true);
      }, 150);
    });
  }
  paint(true);
})();
</script>
</body>
</html>`;
}

/** "Ventas noviembre.xlsx" → "Ventas noviembre": the page's title. */
export function tableTitle(filename: string, lang: Lang): string {
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.(xlsx|csv)$/i, '').replace(/[_\s]+/g, ' ').trim().slice(0, 120);
  return base || (lang === 'es' ? 'Tabla' : 'Table');
}

/**
 * The 'table' template of POST /v1/home/new. The caller already passed the workspace and
 * publish-limit checks; this reads the file, refuses one it cannot use (nothing is created), then
 * publishes the page and writes its rows.
 */
export async function handleNewTable(
  env: Env,
  user: { id: string; email: string | null },
  file: unknown,
  lang: Lang,
  workspaceId: string | null,
): Promise<Response> {
  const f = (file && typeof file === 'object' ? file : {}) as { name?: unknown; content?: unknown };
  const name = typeof f.name === 'string' ? f.name.trim().slice(0, 200) : '';
  const content = typeof f.content === 'string' ? f.content : '';
  if (!name || !content) return tableError(lang, 'NO_FILE');
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext !== 'xlsx' && ext !== 'csv') return tableError(lang, 'NOT_A_SHEET', name);
  // base64 is 4 chars per 3 bytes: refuse an oversized file before decoding it.
  if (Math.floor((content.length * 3) / 4) > XLSX_MAX_INPUT_BYTES + 3) return tableError(lang, 'TOO_LARGE', name);
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(content); } catch { return tableError(lang, 'UNREADABLE', name); }
  if (bytes.byteLength > XLSX_MAX_INPUT_BYTES) return tableError(lang, 'TOO_LARGE', name);
  if (!looksLike(ext, bytes)) return tableError(lang, 'NOT_A_SHEET', name);

  let parsed: Awaited<ReturnType<typeof sheetRows>>;
  try {
    parsed = await sheetRows(bytes);
  } catch (e) {
    const code = e instanceof SheetRowsError
      ? ({ TOO_LARGE: 'TOO_LARGE', TOO_MANY_ROWS: 'TOO_MANY_ROWS', EMPTY: 'NO_ROWS' } as Record<string, TableErrorCode>)[e.code] ?? 'UNREADABLE'
      : 'UNREADABLE';
    return tableError(lang, code, name);
  }
  if (!parsed.rows.length) return tableError(lang, 'NO_ROWS', name);

  const title = tableTitle(name, lang);
  const dataset = TABLE_DATASET[lang];
  const html = buildTableHtml({ title, lang, dataset });
  const quota = await checkStorageQuota(env, user.id, [
    { path: 'index.html', content: html, mime: 'text/html' },
    { path: `${dataset}.json`, content: JSON.stringify(parsed.rows), mime: 'application/json' },
  ]);
  if (!quota.allowed) return Response.json({ error: storageLimitMessage(quota), code: 'STORAGE_LIMIT_EXCEEDED' }, { status: 413 });

  const base = generateSlug(title.normalize('NFD').replace(/[̀-ͯ]/g, '')) || 'tabla';
  const slug = `${base}-${crypto.randomUUID().slice(0, 6)}`;
  const published = await publishGeneratedHtml(env, { id: user.id, email: user.email || '' }, {
    name: title, slug, html, workspaceId, visibility: 'private',
  });
  await incrementRateLimit(env, user.id, 'publish', user.email);
  const out = { artifactId: published.artifact.id, slug: published.deployment.slug, name: title };
  try {
    const res = await writeDatasetRows(env, out.artifactId, dataset, 'json', parsed.rows, {
      source: { provider: 'upload', file: name, sheet: parsed.sheet, syncedAt: new Date().toISOString() },
    });
    return Response.json({ ok: true, ...out, rowCount: res.rowCount, columns: Object.keys(parsed.rows[0]).length, sheet: parsed.sheet });
  } catch {
    // The page exists and shows its empty state; say so, and where to find it.
    return Response.json({ ...out, error: ERRORS[lang].WRITE_FAILED, code: 'WRITE_FAILED' }, { status: STATUS.WRITE_FAILED });
  }
}
