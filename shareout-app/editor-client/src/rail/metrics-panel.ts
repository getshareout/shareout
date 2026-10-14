// "Metrics & Alerts" rail panel — lets the artifact owner expose followable
// metrics and see/remove alert rules in-context while building. Uses the
// /v1/metric-alerts API (session-cookie auth). Mirrors the Connect panel.
import type { EditorContext } from '../editor/context';
import { escapeHtml } from '../utils';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { optimistic, ActionError } from '../optimistic';

export interface MetricDefinitionSummary {
  metric_id: string;
  label: string;
  format?: string | null;
  source?: { type?: string };
}

export interface AlertRuleSummary {
  id: string;
  name: string;
  metric_id: string;
  enabled: boolean;
  on_trigger?: { crew?: boolean } | null;
  history?: number[];
}

/** Tiny inline trend sparkline from recent evaluated values. */
function sparkline(vals?: number[]): string {
  if (!vals || vals.length < 2) return '';
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1, w = 64, h = 16, n = vals.length;
  const pts = vals.map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - ((v - min) / rng) * h).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle;margin-left:8px" aria-hidden="true"><polyline fill="none" stroke="#2563eb" stroke-width="1.5" points="${pts}"/></svg>`;
}

export function renderMetricDefsMarkup(defs: MetricDefinitionSummary[]): string {
  if (!defs.length) {
    return `
      <div class="rail-empty">
        <p class="rail-empty-title">No followable metrics yet</p>
        <p class="rail-empty-hint">Write the displayed value to the JSON store (e.g. <code>metrics.revenue</code>), then add it above so viewers can follow it.</p>
      </div>`;
  }
  return `<div class="connect-list">${defs
    .map(
      (m) => `
      <div class="connect-item">
        <div class="connect-item-info">
          <span class="connect-item-name">${escapeHtml(m.label || m.metric_id)}</span>
          <span class="connect-item-type">${escapeHtml(m.metric_id)}${m.source?.type ? ' · ' + escapeHtml(m.source.type) : ''}</span>
        </div>
        <button class="so-c-btn so-c-btn--ghost so-c-btn--sm" data-metric-del="${escapeHtml(m.metric_id)}">Remove</button>
      </div>`,
    )
    .join('')}</div>`;
}

export function renderAlertSummaryMarkup(alerts: AlertRuleSummary[]): string {
  const head = '<div class="connect-add-title" style="margin-top:1rem">Alerts on this page</div>';
  if (!alerts.length) {
    return `${head}<div class="rail-empty"><p class="rail-empty-hint">No alerts yet. Viewers can follow a metric from the published page’s toolbar.</p></div>`;
  }
  return `${head}<div class="connect-list">${alerts
    .map((a) => {
      const crewOn = !!a.on_trigger?.crew;
      return `
      <div class="connect-item">
        <div class="connect-item-info">
          <span class="connect-item-name">${escapeHtml(a.name || a.metric_id)}${a.enabled ? '' : ' (paused)'}${sparkline(a.history)}</span>
          <span class="connect-item-type">${escapeHtml(a.metric_id)}${crewOn ? ' · crew on' : ''}</span>
        </div>
        <button class="so-c-btn so-c-btn--ghost so-c-btn--sm" data-alert-crew="${escapeHtml(a.id)}" data-crew="${crewOn ? '1' : '0'}">${crewOn ? 'Crew: on' : 'Crew: off'}</button>
        <button class="so-c-btn so-c-btn--ghost so-c-btn--sm" data-alert-del="${escapeHtml(a.id)}">Delete</button>
      </div>`;
    })
    .join('')}</div>`;
}

/** Full panel: add-a-metric form, the metric list, then the alert summary. */
export function metricsPanelMarkup(defs: MetricDefinitionSummary[], alerts: AlertRuleSummary[]): string {
  return `
    <div class="connect-add">
      <div class="connect-add-title">Add a followable metric</div>
      <input class="rail-input" data-metric-id placeholder="ID (e.g. revenue)" autocomplete="off">
      <input class="rail-input" data-metric-label placeholder="Label (e.g. Revenue)" autocomplete="off">
      <input class="rail-input" data-metric-key placeholder="JSON key (e.g. metrics)" autocomplete="off">
      <input class="rail-input" data-metric-path placeholder="Path (e.g. $.revenue)" autocomplete="off">
      <button class="so-c-btn so-c-btn--primary so-c-btn--sm" data-metric-add>Add metric</button>
      <p class="rail-empty-hint connect-add-status" data-metric-status></p>
    </div>
    ${renderMetricDefsMarkup(defs)}
    ${renderAlertSummaryMarkup(alerts)}`;
}

// Metrics / alerts deleted optimistically whose DELETE hasn't landed (undo window or in
// flight) — a reload during that window must not flash them back in.
const pendingMetricDeletes = new Set<string>();
const pendingAlertDeletes = new Set<string>();

export async function renderMetricsPanel(ctx: EditorContext, host: HTMLElement): Promise<void> {
  host.innerHTML = '<div class="rail-empty"><p class="rail-empty-hint">Loading metrics…</p></div>';
  const artifactId = ctx.config.artifactId;
  try {
    const [defsRes, alertsRes] = await Promise.all([
      fetch(`/v1/metric-alerts/definitions?artifact_id=${artifactId}`, { credentials: 'same-origin' }),
      fetch(`/v1/metric-alerts?artifact_id=${artifactId}`, { credentials: 'same-origin' }),
    ]);
    if (!defsRes.ok) throw new Error(String(defsRes.status));
    const defs = ((await defsRes.json()) as { definitions?: MetricDefinitionSummary[] }).definitions || [];
    const alerts = alertsRes.ok ? ((await alertsRes.json()) as { alerts?: AlertRuleSummary[] }).alerts || [] : [];
    paintMetricsPanel(
      ctx,
      host,
      defs.filter((d) => !pendingMetricDeletes.has(d.metric_id)),
      alerts.filter((a) => !pendingAlertDeletes.has(a.id)),
    );
  } catch {
    host.innerHTML = '<div class="rail-empty"><p class="rail-empty-hint">Couldn’t load metrics.</p></div>';
  }
}

interface MetricForm { id: string; label: string; key: string; path: string }

/** Render from local state (optimistic updates repaint without a round-trip). */
function paintMetricsPanel(
  ctx: EditorContext,
  host: HTMLElement,
  defs: MetricDefinitionSummary[],
  alerts: AlertRuleSummary[],
  form?: MetricForm,
  statusText?: string,
): void {
  host.innerHTML = metricsPanelMarkup(defs, alerts);
  if (form) {
    const set = (sel: string, v: string): void => {
      const el = host.querySelector<HTMLInputElement>(sel);
      if (el) el.value = v;
    };
    set('[data-metric-id]', form.id);
    set('[data-metric-label]', form.label);
    set('[data-metric-key]', form.key);
    set('[data-metric-path]', form.path);
  }
  const status = host.querySelector<HTMLElement>('[data-metric-status]');
  if (status && statusText) status.textContent = statusText;
  wireMetricsPanel(ctx, host, defs, alerts);
}

async function failWithServerMessage(res: Response): Promise<never> {
  const err = (await res.json().catch(() => ({}))) as { error?: string };
  throw new ActionError(err.error || `Request failed (${res.status})`);
}

function wireMetricsPanel(ctx: EditorContext, host: HTMLElement, defs: MetricDefinitionSummary[], alerts: AlertRuleSummary[]): void {
  const artifactId = ctx.config.artifactId;
  const status = host.querySelector<HTMLElement>('[data-metric-status]');
  const paint = (d: MetricDefinitionSummary[], a: AlertRuleSummary[], form?: MetricForm, msg?: string): void =>
    paintMetricsPanel(ctx, host, d, a, form, msg);

  host.querySelector<HTMLButtonElement>('[data-metric-add]')?.addEventListener('click', () => {
    const form: MetricForm = {
      id: host.querySelector<HTMLInputElement>('[data-metric-id]')?.value.trim() || '',
      label: host.querySelector<HTMLInputElement>('[data-metric-label]')?.value.trim() || '',
      key: host.querySelector<HTMLInputElement>('[data-metric-key]')?.value.trim() || '',
      path: host.querySelector<HTMLInputElement>('[data-metric-path]')?.value.trim() || '',
    };
    if (status) status.textContent = '';
    if (!form.id || !form.label || !form.key || !form.path) {
      if (status) status.textContent = 'ID, label, JSON key, and path are all required.';
      return;
    }
    // The new metric shows in the list at once; a refusal puts the form back as typed.
    const next = defs
      .filter((d) => d.metric_id !== form.id)
      .concat({ metric_id: form.id, label: form.label, source: { type: 'json_path' } });
    void optimistic({
      key: `metric-add:${form.id}`,
      apply: () => paint(next, alerts),
      rollback: (err) => paint(defs, alerts, form, err instanceof ActionError ? `Couldn’t add: ${err.message}` : undefined),
      request: async () => {
        const res = await fetch('/v1/metric-alerts/definitions', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            artifact_id: artifactId,
            metric_id: form.id,
            label: form.label,
            source: { type: 'json_path', key: form.key, path: form.path },
          }),
        });
        if (!res.ok) await failWithServerMessage(res);
        return res;
      },
      success: 'Metric added',
      error: (e) => (e instanceof ActionError ? `Couldn’t add metric: ${e.message}` : 'Couldn’t add metric. Check your connection?'),
    });
  });

  host.querySelectorAll<HTMLButtonElement>('[data-metric-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const metricId = btn.dataset.metricDel;
      if (!metricId) return;
      const ok = await showConfirmDialog({
        title: 'Remove this metric?',
        body: `Remove “${metricId}”? Alerts that use it will stop matching.`,
        confirmLabel: 'Remove metric',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
      void optimistic({
        key: `metric-del:${metricId}`,
        undo: true,
        apply: () => {
          pendingMetricDeletes.add(metricId);
          paint(defs.filter((d) => d.metric_id !== metricId), alerts);
        },
        rollback: () => {
          pendingMetricDeletes.delete(metricId);
          paint(defs, alerts);
        },
        request: async () => {
          const res = await fetch(`/v1/metric-alerts/definitions/${artifactId}/${encodeURIComponent(metricId)}`, {
            method: 'DELETE',
            credentials: 'same-origin',
            keepalive: true,
          });
          if (res.ok) pendingMetricDeletes.delete(metricId);
          return res;
        },
        success: 'Metric removed',
        error: 'Couldn’t remove the metric. Check your connection?',
      });
    });
  });

  host.querySelectorAll<HTMLButtonElement>('[data-alert-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.alertDel;
      if (!id) return;
      const ok = await showConfirmDialog({
        title: 'Delete this alert?',
        body: 'The alert rule will be removed. You can create a new one later.',
        confirmLabel: 'Delete alert',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
      void optimistic({
        key: `alert-del:${id}`,
        undo: true,
        apply: () => {
          pendingAlertDeletes.add(id);
          paint(defs, alerts.filter((a) => a.id !== id));
        },
        rollback: () => {
          pendingAlertDeletes.delete(id);
          paint(defs, alerts);
        },
        request: async () => {
          const res = await fetch(`/v1/metric-alerts/${id}`, { method: 'DELETE', credentials: 'same-origin', keepalive: true });
          if (res.ok) pendingAlertDeletes.delete(id);
          return res;
        },
        success: 'Alert deleted',
        error: 'Couldn’t delete the alert. Check your connection?',
      });
    });
  });

  host.querySelectorAll<HTMLButtonElement>('[data-alert-crew]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.alertCrew;
      const enable = btn.dataset.crew !== '1'; // toggle
      if (!id) return;
      const flipped = alerts.map((a) => (a.id === id ? { ...a, on_trigger: { ...(a.on_trigger || {}), crew: enable } } : a));
      void optimistic({
        key: `alert-crew:${id}`,
        apply: () => paint(defs, flipped),
        rollback: () => paint(defs, alerts),
        request: () =>
          fetch(`/v1/metric-alerts/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ on_trigger: { crew: enable } }),
          }),
        success: enable ? 'Crew will investigate when this fires' : 'Crew-following off',
        error: 'Couldn’t change crew-following',
      });
    });
  });
}
