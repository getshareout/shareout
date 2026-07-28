// Data tab — browse, create, and bind ShareOut storage (JSON · Files · Tables · Connectors)
import type { EditorContext } from '../editor/context';
import { createLogger } from '../editor/logger';
import { buildManifestSummary, type ManifestSummary } from '../manifest/manifest-parser';
import { escapeHtml } from '../utils';
import { showToast } from '../toast';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { syncHtmlFromCanvas } from '../history/html-sync';
import { markDirty } from '../persistence/draft';
import { pushUndo } from '../history/undo-redo';
import { renderConnectPanel } from './connect-panel';

const log = createLogger('data-browser');

interface JsonKey { key: string; value: unknown; type: string }
interface BlobFile { id: string; filename: string; mime: string; size: number; url: string }

function sdkUrl(ctx: EditorContext, type: string, action: string): string {
  return `/v1/artifacts/${ctx.config.artifactId}/editor/sdk/${type}/${action}`;
}

async function sdkGet<T>(ctx: EditorContext, type: string): Promise<T | null> {
  try {
    const res = await fetch(sdkUrl(ctx, type, 'get'), { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    log.warn(`sdkGet ${type} failed`, err);
    return null;
  }
}

/** Live row count for a manifest table (best-effort; null on failure). */
async function fetchTableRowCount(ctx: EditorContext, tableName: string): Promise<number | null> {
  try {
    const res = await fetch(sdkUrl(ctx, 'table', 'get'), {
      credentials: 'same-origin',
      headers: { 'X-SDK-Component-Name': tableName },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { totalRows?: number };
    return typeof data.totalRows === 'number' ? data.totalRows : null;
  } catch (err) {
    log.warn(`table count ${tableName} failed`, err);
    return null;
  }
}

async function fetchTableRowCounts(
  ctx: EditorContext,
  tables: NonNullable<ManifestSummary['tables']>,
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    tables.map(async (t) => [t.name, await fetchTableRowCount(ctx, t.name)] as const),
  );
  const counts: Record<string, number> = {};
  for (const [name, count] of entries) {
    if (count !== null) counts[name] = count;
  }
  return counts;
}

export async function renderDataBrowser(ctx: EditorContext): Promise<void> {
  const host = ctx.dom.dataBrowser;
  if (!host) return;

  host.innerHTML = `<div class="rail-empty"><p class="rail-empty-hint">Loading data…</p></div>`;

  const [json, blobs] = await Promise.all([
    sdkGet<{ keys: JsonKey[] }>(ctx, 'json'),
    sdkGet<{ files: BlobFile[] }>(ctx, 'blobs'),
  ]);

  const jsonKeys = json?.keys ?? [];
  const files = blobs?.files ?? [];
  const dataModel = buildManifestSummary(ctx.state.manifest);
  const rowCounts = await fetchTableRowCounts(ctx, dataModel?.tables ?? []);

  host.innerHTML = `
    ${renderJsonSection(jsonKeys)}
    ${renderFilesSection(files)}
    ${renderDataModelMarkup(dataModel, rowCounts)}
    ${renderConnectorsSection()}
  `;

  wireJson(ctx, host);
  wireFiles(ctx, host);

  // Connectors live inside Data now — same panel renderer, hosted in this section.
  const connHost = host.querySelector<HTMLElement>('#data-connectors');
  if (connHost) void renderConnectPanel(ctx, connHost);
}

/* ----------------------------- Connectors ----------------------------- */

function renderConnectorsSection(): string {
  return `
    <div class="data-section">
      <div class="data-section-head">
        <h3 class="data-section-title">Connectors</h3>
      </div>
      <div id="data-connectors"><p class="data-empty">Loading…</p></div>
    </div>`;
}

/* ----------------------------- JSON ----------------------------- */

function renderJsonSection(keys: JsonKey[]): string {
  return `
    <div class="data-section">
      <div class="data-section-head">
        <h3 class="data-section-title">JSON</h3>
        <button class="data-add" data-add="json">+ Add key</button>
      </div>
      <div class="data-list" data-list="json">
        ${keys.length ? keys.map(renderJsonRow).join('') : emptyRow('No keys yet')}
      </div>
    </div>`;
}

function renderJsonRow(k: JsonKey): string {
  const valueStr = typeof k.value === 'string' ? k.value : JSON.stringify(k.value);
  return `
    <div class="data-row" data-key="${escapeHtml(k.key)}">
      <span class="data-row-name">${escapeHtml(k.key)}</span>
      <input class="data-row-value" value="${escapeHtml(valueStr)}" data-json-value="${escapeHtml(k.key)}">
      <button class="data-row-btn" data-bind="${escapeHtml(k.key)}" title="Bind to selected element">Bind</button>
      <button class="data-row-btn data-row-btn-danger" data-del-json="${escapeHtml(k.key)}" title="Delete">&times;</button>
    </div>`;
}

function wireJson(ctx: EditorContext, host: HTMLElement): void {
  host.querySelector('[data-add="json"]')?.addEventListener('click', () => showAddKeyForm(ctx, host));

  host.querySelectorAll<HTMLInputElement>('[data-json-value]').forEach((input) => {
    input.addEventListener('change', async () => {
      const key = input.dataset.jsonValue!;
      let value: unknown = input.value;
      try { value = JSON.parse(input.value); } catch { /* keep string */ }
      await postJson(ctx, 'set', { key, value });
      showToast(`Saved ${key}`, 'success');
    });
  });

  host.querySelectorAll<HTMLButtonElement>('[data-del-json]').forEach((btn) => {
    btn.addEventListener('click', () => confirmDeleteJson(ctx, btn));
  });

  host.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((btn) => {
    btn.addEventListener('click', () => bindKeyToSelection(ctx, btn.dataset.bind!));
  });
}

async function postJson(ctx: EditorContext, action: string, body: unknown): Promise<void> {
  try {
    await fetch(sdkUrl(ctx, 'json', action), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch (err) {
    log.error('postJson failed', err);
    showToast('Could not save. Check your connection?', 'error');
  }
}

/** Inline "add key" form (replaces window.prompt) — appended into the JSON list. */
function showAddKeyForm(ctx: EditorContext, host: HTMLElement): void {
  const list = host.querySelector<HTMLElement>('[data-list="json"]');
  if (!list || list.querySelector('[data-new-key]')) return; // already open

  const row = document.createElement('div');
  row.className = 'data-row';
  row.innerHTML = `
    <input class="data-row-value" data-new-key placeholder="key" autocomplete="off">
    <input class="data-row-value" data-new-value placeholder="value (text or JSON)" autocomplete="off">
    <button class="data-row-btn" data-new-save>Add</button>
    <button class="data-row-btn data-row-btn-danger" data-new-cancel title="Cancel">&times;</button>`;
  list.prepend(row);

  const keyInput = row.querySelector<HTMLInputElement>('[data-new-key]');
  keyInput?.focus();

  const save = async (): Promise<void> => {
    const key = keyInput?.value.trim();
    if (!key) { keyInput?.focus(); return; }
    const raw = row.querySelector<HTMLInputElement>('[data-new-value]')?.value ?? '';
    let value: unknown = raw;
    try { value = JSON.parse(raw); } catch { /* keep as string */ }
    await postJson(ctx, 'set', { key, value });
    showToast(`Added ${key}`, 'success');
    void renderDataBrowser(ctx);
  };

  row.querySelector('[data-new-save]')?.addEventListener('click', () => void save());
  row.querySelector('[data-new-cancel]')?.addEventListener('click', () => void renderDataBrowser(ctx));
  keyInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void save();
    else if (e.key === 'Escape') void renderDataBrowser(ctx);
  });
}

/** Inline two-step delete confirm (replaces window.confirm). */
function confirmDeleteJson(ctx: EditorContext, btn: HTMLButtonElement): void {
  const key = btn.dataset.delJson;
  if (!key) return;
  const row = btn.closest('.data-row');
  if (!row) return;

  const confirmEl = document.createElement('span');
  confirmEl.className = 'data-row-confirm';
  confirmEl.innerHTML = `
    <button class="data-row-btn data-row-btn-danger" data-confirm-del>Delete?</button>
    <button class="data-row-btn" data-cancel-del title="Keep">&times;</button>`;
  btn.replaceWith(confirmEl);

  confirmEl.querySelector('[data-cancel-del]')?.addEventListener('click', () => void renderDataBrowser(ctx));
  confirmEl.querySelector('[data-confirm-del]')?.addEventListener('click', async () => {
    await postJson(ctx, 'delete', { key });
    row.remove();
    showToast(`Deleted ${key}`, 'success');
  });
}

/** Write data-key onto the selected element so it renders from the JSON store. */
function bindKeyToSelection(ctx: EditorContext, key: string): void {
  const el = ctx.state.selectedElement;
  if (!el) {
    showToast('Select an element first, then bind', 'warning');
    return;
  }
  pushUndo(ctx.state);
  // Write the v2 binding convention; clear any legacy attrs so there's one source of truth.
  el.setAttribute('data-shareout-binding', `json:${key}`);
  ['data-key', 'data-json-key', 'data-field', 'data-sdk-value', 'data-bind'].forEach((a) => el.removeAttribute(a));
  syncHtmlFromCanvas(ctx);
  markDirty(ctx);
  showToast(`Bound to json:${key}`, 'success');
}

/* ----------------------------- Files ----------------------------- */

function renderFilesSection(files: BlobFile[]): string {
  return `
    <div class="data-section">
      <div class="data-section-head">
        <h3 class="data-section-title">Files</h3>
        <button class="data-add" data-add="blob">+ Upload</button>
        <input type="file" data-blob-input hidden>
      </div>
      <div class="data-list" data-list="blob">
        ${files.length ? files.map(renderBlobRow).join('') : emptyRow('No files yet')}
      </div>
    </div>`;
}

function renderBlobRow(f: BlobFile): string {
  return `
    <div class="data-row" data-id="${escapeHtml(f.id)}">
      <span class="data-row-name">${escapeHtml(f.filename)}</span>
      <span class="data-row-meta">${formatSize(f.size)}</span>
      <button class="data-row-btn" data-copy="${escapeHtml(f.url)}" title="Copy URL">Copy</button>
      <button class="data-row-btn data-row-btn-danger" data-del-blob="${escapeHtml(f.id)}" title="Delete">&times;</button>
    </div>`;
}

function wireFiles(ctx: EditorContext, host: HTMLElement): void {
  const input = host.querySelector<HTMLInputElement>('[data-blob-input]');
  host.querySelector('[data-add="blob"]')?.addEventListener('click', () => input?.click());

  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(sdkUrl(ctx, 'blobs', 'upload'), {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });
      if (!res.ok) throw new Error(String(res.status));
      showToast(`Uploaded ${file.name}`, 'success');
      renderDataBrowser(ctx);
    } catch (err) {
      log.error('upload failed', err);
      showToast('Upload failed', 'error');
    }
  });

  host.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigator.clipboard?.writeText(btn.dataset.copy!);
      showToast('URL copied', 'success');
    });
  });

  host.querySelectorAll<HTMLButtonElement>('[data-del-blob]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delBlob!;
      const ok = await showConfirmDialog({
        title: 'Delete this file?',
        body: 'The file will be removed from this artifact’s blob store.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
      try {
        await fetch(sdkUrl(ctx, 'blobs', 'delete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ id }),
        });
        host.querySelector(`.data-row[data-id="${CSS.escape(id)}"]`)?.remove();
      } catch (err) {
        log.error('delete blob failed', err);
        showToast('Could not delete', 'error');
      }
    });
  });
}

/* ----------------------------- Tables ----------------------------- */

/**
 * Read-only catalog of the artifact's declared data model — surfaces what the manifest
 * declares (table schemas, computed values + formulas, formatters, realtime docs) that
 * was previously invisible. Pure string builder; exported for testing.
 */
export function renderDataModelMarkup(
  summary: ManifestSummary | null,
  rowCounts: Record<string, number> = {},
): string {
  const tables = summary?.tables ?? [];
  const out: string[] = [];

  out.push(dataSection('Tables', tables.length
    ? tables.map((t) => {
        const fieldsLabel = t.fields.length
          ? escapeHtml(t.fields.map((f) => f.name + (f.primary ? ' (id)' : '')).join(', '))
          : 'dataset';
        const count = rowCounts[t.name];
        const countLabel = count === undefined ? '' : ` · ${count} row${count === 1 ? '' : 's'}`;
        return `
        <div class="data-row">
          <span class="data-row-name">${escapeHtml(t.name)}</span>
          <span class="data-row-meta">${fieldsLabel}${countLabel}</span>
        </div>`;
      }).join('')
    : emptyRow('Declare tables in your manifest to see them here')));

  if (summary?.computed?.length) {
    out.push(dataSection('Computed', summary.computed.map((c) => `
        <div class="data-row">
          <span class="data-row-name">${escapeHtml(c.name)}</span>
          <span class="data-row-meta">${c.formula ? escapeHtml(c.formula) : 'computed'}</span>
        </div>`).join('')));
  }

  if (summary?.formatters?.length) {
    out.push(dataSection('Formatters', summary.formatters
      .map((f) => `<div class="data-row"><span class="data-row-name">${escapeHtml(f)}</span></div>`).join('')));
  }

  if (summary?.realtime?.length) {
    out.push(dataSection('Realtime', summary.realtime.map((d) => `
        <div class="data-row">
          <span class="data-row-name">${escapeHtml(d)}</span>
          <span class="data-row-meta">live</span>
        </div>`).join('')));
  }

  return out.join('');
}

function dataSection(title: string, rows: string): string {
  return `
    <div class="data-section">
      <div class="data-section-head">
        <h3 class="data-section-title">${escapeHtml(title)}</h3>
      </div>
      <div class="data-list">${rows}</div>
    </div>`;
}

/* ----------------------------- helpers ----------------------------- */

function emptyRow(text: string): string {
  return `<p class="data-empty">${escapeHtml(text)}</p>`;
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}
