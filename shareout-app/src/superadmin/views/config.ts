/**
 * Superadmin portal navigation: view definitions, time ranges, and URL resolution.
 *
 * Views map to `?view=` query params; ranges map to `?range=` for metrics windows.
 * `sinceExpr` values are SQLite datetime modifiers passed to datetime()/strftime('%Y-%m-%dT%H:%M:%fZ','now').
 */

/** One sidebar entry in the admin portal. */
export interface ViewDef {
  key: string;
  title: string;
  /** Inline SVG path(s) for the sidebar icon. */
  icon: string;
  /** When true, the top bar shows the time-range selector. */
  range: boolean;
}

/** A selectable metrics window (7d, 30d, YTD, …). */
export interface RangeDef {
  key: string;
  /** Representative window length for deltas and rate proration. */
  days: number;
  label: string;
  sinceExpr: string;
}

export const VIEWS: ViewDef[] = [
  { key: 'overview', title: 'Overview', range: true, icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>' },
  { key: 'instance', title: 'Instance', range: false, icon: '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>' },
  { key: 'health', title: 'Health', range: false, icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
  { key: 'costs', title: 'Costs', range: true, icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
  { key: 'workspace-costs', title: 'Cost by workspace', range: true, icon: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/>' },
  { key: 'artifacts', title: 'Artifacts', range: true, icon: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>' },
  { key: 'traffic', title: 'Traffic', range: true, icon: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>' },
  { key: 'funnel', title: 'Funnel', range: true, icon: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>' },
  { key: 'tokens', title: 'LLM tokens', range: true, icon: '<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/>' },
  { key: 'operations', title: 'Operations', range: false, icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
  { key: 'users', title: 'Users', range: false, icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
  { key: 'moderation', title: 'Moderation', range: false, icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
  { key: 'support', title: 'Support', range: false, icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
  { key: 'features', title: 'Features', range: false, icon: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="10" r="2"/><circle cx="20" cy="14" r="2"/>' },
  { key: 'audit', title: 'Audit log', range: false, icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="11" x2="13" y2="11"/>' },
  { key: 'storage', title: 'Storage', range: false, icon: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>' },
];

export const DEFAULT_VIEW = 'overview';

export const RANGES: RangeDef[] = [
  { key: 'today', days: 1, label: 'Today', sinceExpr: 'start of day' },
  { key: '7', days: 7, label: '7d', sinceExpr: '-7 days' },
  { key: 'mtd', days: 30, label: 'MTD', sinceExpr: 'start of month' },
  { key: '30', days: 30, label: '30d', sinceExpr: '-30 days' },
  { key: '90', days: 90, label: '90d', sinceExpr: '-90 days' },
  { key: 'ytd', days: 365, label: 'YTD', sinceExpr: 'start of year' },
  { key: '365', days: 365, label: '1y', sinceExpr: '-365 days' },
  { key: 'all', days: 3650, label: 'All', sinceExpr: '-3650 days' },
];

export const DEFAULT_RANGE = RANGES.find((r) => r.key === '30')!;

/** Resolve `?range=` to a known window, falling back to 30d. */
export function resolveRange(url: URL): RangeDef {
  const key = url.searchParams.get('range') || DEFAULT_RANGE.key;
  return RANGES.find((r) => r.key === key) || DEFAULT_RANGE;
}

/** Resolve `?view=` to a known sidebar entry, falling back to overview. */
export function resolveView(url: URL): ViewDef {
  const key = url.searchParams.get('view') || DEFAULT_VIEW;
  return VIEWS.find((v) => v.key === key) || VIEWS[0];
}

/** HTML for the horizontal time-range button strip in the top bar. */
export function rangeButtons(viewKey: string, rangeKey: string): string {
  return `<div class="sa-range">${RANGES.map(
    (r) => `<a href="?view=${viewKey}&range=${r.key}" class="sa-range-btn${r.key === rangeKey ? ' active' : ''}">${r.label}</a>`
  ).join('')}</div>`;
}
