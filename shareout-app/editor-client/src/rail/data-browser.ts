// Data tab — browse, create, and bind ShareOut storage (JSON · Files · Tables · Connectors)
import type { EditorContext } from '../editor/context';
import { createLogger } from '../editor/logger';
import { buildManifestSummary, type ManifestSummary } from '../manifest/manifest-parser';
import { escapeHtml } from '../utils';
import { showToast } from '../toast';
import { optimistic, withBusy } from '../optimistic';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { syncHtmlFromCanvas } from '../history/html-sync';
import { markDirty } from '../persistence/draft';
import { pushUndo } from '../history/undo-redo';
import { renderConnectPanel } from './connect-panel';
import { renderSourcesSection } from './sources-section';

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

const pendingJsonDeletes = new Set<string>();
const pendingBlobDeletes = new Set<string>();

export async function renderDataBrowser(ctx: EditorContext): Promise<void> {
  const host = ctx.dom.dataBrowser;
  if (!host) return;

  host.innerHTML = `<div class="rail-empty"><p class="rail-empty-hint">Loading data…</p></div>`;

  const [json, blobs] = await Promise.all([
    sdkGet<{ keys: JsonKey[] }>(ctx, 'json'),
    sdkGet<{ files: BlobFile[] }>(ctx, 'blobs'),
  ]);

  // Hide rows whose delete is still in its undo window / in flight so a reload can't flash them back.
  const jsonKeys = (json?.keys ?? []).filter((k) => !pendingJsonDeletes.has(k.key));
  const files = (blobs?.files ?? []).filter((f) => !pendingBlobDeletes.has(f.id));
  const dataModel = buildManifestSummary(ctx.state.manifest);
  const rowCounts = await fetchTableRowCounts(ctx, dataModel?.tables ?? []);

  host.innerHTML = `
    <div id="data-sources"></div>
    ${renderJsonSection(jsonKeys)}
    ${renderFilesSection(files)}
    ${renderDataModelMarkup(dataModel, rowCounts)}
    ${renderConnectorsSection()}
  `;

  wireJson(ctx, host);
  wireFiles(ctx, host);

  // Where the published page's data comes from, and what each source feeds.
  const sourcesHost = host.querySelector<HTMLElement>('#data-sources');
  if (sourcesHost) void renderSourcesSection(ctx, sourcesHost);

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
    // Optimistic: the input already shows the new value; defaultValue holds the last saved one.
    input.addEventListener('change', () => {
      const key = input.dataset.jsonValue!;
      const typed = input.value;
      let value: unknown = typed;
      try { value = JSON.parse(typed); } catch { /* keep string */ }
      void optimistic({
        rollback: () => { if (input.value === typed) input.value = input.defaultValue; },
        request: () => postJson(ctx, 'set', { key, value }),
        success: `Saved ${key}`,
        error: `Couldn’t save ${key}. Check your connection?`,
        done: () => { input.defaultValue = typed; },
      });
    });
  });

  host.querySelectorAll<HTMLButtonElement>('[data-del-json]').forEach((btn) => {
    btn.addEventListener('click', () => confirmDeleteJson(ctx, btn));
  });

  host.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((btn) => {
    btn.addEventListener('click', () => bindKeyToSelection(ctx, btn.dataset.bind!));
  });
}

/** JSON-store write; resolves to the Response (non-ok = failure for optimistic()). */
function postJson(ctx: EditorContext, action: string, body: unknown, opts: { keepalive?: boolean } = {}): Promise<Response> {
  return fetch(sdkUrl(ctx, 'json', action), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    keepalive: !!opts.keepalive,
  }).catch((err) => {
    log.error('postJson failed', err);
    throw err;
  });
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

  // Optimistic: the form row becomes the real row at once; a failure brings the form back as typed.
  const save = (): void => {
    const key = keyInput?.value.trim();
    if (!key) { keyInput?.focus(); return; }
    const raw = row.querySelector<HTMLInputElement>('[data-new-value]')?.value ?? '';
    let value: unknown = raw;
    try { value = JSON.parse(raw); } catch { /* keep as string */ }
    const tmp = document.createElement('div');
    tmp.innerHTML = renderJsonRow({ key, value } as JsonKey);
    const added = tmp.firstElementChild as HTMLElement;
    void optimistic({
      key: `json-add:${key}`,
      apply: () => row.replaceWith(added),
      rollback: () => added.replaceWith(row),
      request: () => postJson(ctx, 'set', { key, value }),
      success: `Added ${key}`,
      error: `Couldn’t add ${key}. Check your connection?`,
      done: () => void renderDataBrowser(ctx),
    });
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
  confirmEl.querySelector('[data-confirm-del]')?.addEventListener('click', () => {
    const el = row as HTMLElement;
    void optimistic({
      key: `json-del:${key}`,
      undo: true,
      apply: () => { pendingJsonDeletes.add(key); el.style.display = 'none'; },
      rollback: () => { pendingJsonDeletes.delete(key); el.style.display = ''; confirmEl.replaceWith(btn); },
      request: () => postJson(ctx, 'delete', { key }, { keepalive: true }),
      success: `Deleted ${key}`,
      error: `Couldn’t delete ${key}. Check your connection?`,
      done: () => { pendingJsonDeletes.delete(key); el.remove(); },
    });
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
  const uploadBtn = host.querySelector<HTMLButtonElement>('[data-add="blob"]');
  uploadBtn?.addEventListener('click', () => input?.click());

  // Exception to optimistic: the file's id/URL come from the server, so the button shows
  // "Uploading…" until the upload settles.
  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    await withBusy(uploadBtn, 'Uploading…', async () => {
      try {
        const res = await fetch(sdkUrl(ctx, 'blobs', 'upload'), {
          method: 'POST',
          credentials: 'same-origin',
          body: form,
        });
        if (!res.ok) {
          // A refusal (too large, no permission, over quota) says why; only a network
          // failure lands in the generic "check your connection" below.
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          showToast(`Couldn’t upload ${file.name}. ${body.error || `Request failed (${res.status})`}`, 'error');
          return;
        }
        showToast(`Uploaded ${file.name}`, 'success');
        void renderDataBrowser(ctx);
      } catch (err) {
        log.error('upload failed', err);
        showToast(`Couldn’t upload ${file.name}. Check your connection?`, 'error');
      }
    });
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
      const row = host.querySelector<HTMLElement>(`.data-row[data-id="${CSS.escape(id)}"]`);
      const name = row?.querySelector('.data-row-name')?.textContent || 'file';
      void optimistic({
        key: `blob-del:${id}`,
        undo: true,
        apply: () => { pendingBlobDeletes.add(id); if (row) row.style.display = 'none'; },
        rollback: () => { pendingBlobDeletes.delete(id); if (row) row.style.display = ''; },
        request: () =>
          fetch(sdkUrl(ctx, 'blobs', 'delete'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ id }),
            keepalive: true,
          }),
        success: `Deleted ${name}`,
        error: `Couldn’t delete ${name}. Check your connection?`,
        done: () => { pendingBlobDeletes.delete(id); row?.remove(); },
      });
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
