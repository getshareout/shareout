import type { Env } from '../types';
import { escapeHtml } from '../html/utils';
import { FEATURES, CATEGORY_LABELS, type FeatureCategory } from '../features/registry';
import { resolveEffectiveFlags, getOverrides, GLOBAL_TARGET } from '../features/flags';

const CATEGORY_ORDER: FeatureCategory[] = ['ai', 'automation', 'destinations', 'integrations', 'collaboration', 'modules'];

function isGlobal(target: string): boolean {
  return target === GLOBAL_TARGET;
}

// One feature row: a Default/On/Off segmented control + the effective value hint.
function featureRow(
  target: string,
  key: string,
  label: string,
  description: string,
  override: boolean | null,
  effective: { value: boolean; source: string }
): string {
  const defaultLabel = isGlobal(target) ? 'Default' : 'Inherit';
  const seg = (val: boolean | null, text: string) => {
    const active = override === val ? ' active' : '';
    const arg = val === null ? 'null' : String(val);
    return `<button class="sa-seg-btn${active}" onclick="saFeature('${escapeHtml(target)}','${escapeHtml(key)}',${arg})">${text}</button>`;
  };
  const hint = `${effective.value ? 'On' : 'Off'} <span class="sa-muted">(${escapeHtml(effective.source)})</span>`;
  return `<div class="sa-feat-row">
    <div class="sa-feat-meta">
      <div class="sa-feat-label">${escapeHtml(label)}</div>
      <div class="sa-feat-desc">${escapeHtml(description)}</div>
    </div>
    <div class="sa-feat-control">
      <div class="sa-seg" data-key="${escapeHtml(key)}">${seg(null, defaultLabel)}${seg(true, 'On')}${seg(false, 'Off')}</div>
      <div class="sa-feat-hint">${hint}</div>
    </div>
  </div>`;
}

// The feature grid for one target (global or a workspace id). Reused by the
// initial page render and the POST/GET fragment responses.
export async function renderFeatureGrid(env: Env, target: string): Promise<string> {
  const workspaceId = isGlobal(target) ? null : target;
  const effective = await resolveEffectiveFlags(env, workspaceId);
  const overrides = await getOverrides(env, workspaceId);

  const groups = CATEGORY_ORDER.map((cat) => {
    const rows = FEATURES.filter((f) => f.category === cat)
      .map((f) => {
        const ov = f.key in overrides ? overrides[f.key] : null;
        return featureRow(target, f.key, f.label, f.description, ov, effective[f.key]);
      })
      .join('');
    if (!rows) return '';
    return `<div class="sa-feat-group"><h3 class="sa-feat-cat">${escapeHtml(CATEGORY_LABELS[cat])}</h3>${rows}</div>`;
  }).join('');

  return `<div class="sa-feat-grid" id="sa-feat-grid">${groups}</div>`;
}

// Full Features view body: target selector (Global + workspace search) + grid.
export async function renderFeaturesBody(env: Env): Promise<string> {
  const grid = await renderFeatureGrid(env, GLOBAL_TARGET);
  return `
    <div class="sa-feat-toolbar">
      <div class="sa-feat-target">
        <button class="so-c-btn so-c-btn--secondary sa-feat-tab active" id="sa-feat-global" onclick="saFeatTarget('${GLOBAL_TARGET}','Global defaults')">Global defaults</button>
        <div class="sa-feat-ws">
          <input id="sa-feat-search" class="so-c-input" type="search" placeholder="…or a workspace by name/slug" autocomplete="off">
          <div class="sa-feat-results" id="sa-feat-results"></div>
        </div>
      </div>
      <div class="sa-feat-current" id="sa-feat-current">Editing: <strong>Global defaults</strong></div>
    </div>
    ${grid}`;
}
