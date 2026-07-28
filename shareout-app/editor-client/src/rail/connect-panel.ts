// "Connect" rail panel — the editor's window into an artifact's data connectors
// (EDIT-08 Stage B). Lists the artifact's generic connections (GET) and adds a REST/BYO-token
// connection (POST) — both via the existing /v1/data/{artifactId}/connections API (no OAuth,
// no new backend). OAuth providers (Sheets) + materialize come in later slices.
import type { EditorContext } from '../editor/context';
import { escapeHtml } from '../utils';
import { showToast } from '../toast';

export interface ConnectionSummary {
  name: string;
  type: string;
  scope: 'artifact' | 'workspace';
}

const TYPE_LABELS: Record<string, string> = {
  rest_api: 'REST API',
  bigquery: 'BigQuery',
  snowflake: 'Snowflake',
  postgres: 'Postgres',
};

export function renderConnectionsMarkup(connections: ConnectionSummary[]): string {
  if (!connections.length) {
    return `
      <div class="rail-empty">
        <p class="rail-empty-title">No connections yet</p>
        <p class="rail-empty-hint">Add a REST API above, or create others (warehouses, Sheets) via the SDK or skill.</p>
      </div>`;
  }
  return `<div class="connect-list">${connections
    .map(
      (c) => `
      <div class="connect-item">
        <div class="connect-item-info">
          <span class="connect-item-name">${escapeHtml(c.name)}</span>
          <span class="connect-item-type">${escapeHtml(TYPE_LABELS[c.type] || c.type)}</span>
        </div>
        <span class="connect-item-scope">${c.scope === 'workspace' ? 'Workspace' : 'This page'}</span>
      </div>`,
    )
    .join('')}</div>`;
}

/** The full panel: an add-a-REST-connection form on top, then the list. */
export function connectPanelMarkup(connections: ConnectionSummary[]): string {
  return `
    <div class="connect-add">
      <div class="connect-add-title">Add a REST connection</div>
      <input class="rail-input" data-conn-name placeholder="Name (e.g. sales_api)" autocomplete="off">
      <input class="rail-input" data-conn-url placeholder="Base URL (https://…)" autocomplete="off">
      <input class="rail-input" data-conn-key type="password" placeholder="Bearer token (optional)" autocomplete="off">
      <button class="so-c-btn so-c-btn--primary so-c-btn--sm" data-conn-add>Add connection</button>
      <p class="rail-empty-hint connect-add-status" data-conn-status></p>
    </div>
    ${renderConnectionsMarkup(connections)}`;
}

export async function renderConnectPanel(ctx: EditorContext, host: HTMLElement): Promise<void> {
  host.innerHTML = '<div class="rail-empty"><p class="rail-empty-hint">Loading connections…</p></div>';
  try {
    const res = await fetch(`/v1/data/${ctx.config.artifactId}/connections`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { connections?: ConnectionSummary[] };
    host.innerHTML = connectPanelMarkup(data.connections || []);
    wireAddConnection(ctx, host);
  } catch {
    host.innerHTML = '<div class="rail-empty"><p class="rail-empty-hint">Couldn’t load connections.</p></div>';
  }
}

function wireAddConnection(ctx: EditorContext, host: HTMLElement): void {
  const addBtn = host.querySelector<HTMLButtonElement>('[data-conn-add]');
  const status = host.querySelector<HTMLElement>('[data-conn-status]');
  addBtn?.addEventListener('click', async () => {
    const name = host.querySelector<HTMLInputElement>('[data-conn-name]')?.value.trim() || '';
    const url = host.querySelector<HTMLInputElement>('[data-conn-url]')?.value.trim() || '';
    const key = host.querySelector<HTMLInputElement>('[data-conn-key]')?.value.trim() || '';
    if (status) status.textContent = '';
    if (!name || !url) {
      if (status) status.textContent = 'Name and base URL are required.';
      return;
    }
    addBtn.disabled = true;
    try {
      const body: Record<string, unknown> = { name, type: 'rest_api', config: { baseUrl: url } };
      if (key) body.credentials = { type: 'api_key', data: { apiKey: key } };
      const res = await fetch(`/v1/data/${ctx.config.artifactId}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message || `Request failed (${res.status})`);
      }
      showToast('Connection added', 'success');
      await renderConnectPanel(ctx, host); // re-fetch + re-render (re-wires handlers)
    } catch (e) {
      if (status) status.textContent = `Couldn’t add: ${(e as Error).message}`;
      addBtn.disabled = false;
    }
  });
}
