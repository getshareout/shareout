// Single source of truth for a chart's data model (EDIT-05 F14). A chart had two competing
// representations that didn't round-trip:
//   A) flat attrs  data-shareout-chart-data/x/y/filter  (the spec + chart-init model)
//   B) config.dataBinding.{source,tableName,jsonKey,apiUrl,xColumn,yColumns} inside the
//      data-shareout-chart JSON (the old "Edit Manual Data" modal model)
// We standardise on (A) for source binding; the config JSON keeps only appearance + manual
// series. `migrateLegacyDataBinding` collapses any legacy (B) onto (A) so old charts keep
// their binding and the two stop conflicting.
import {
  CHART_ATTR,
  CHART_DATA_ATTR,
  CHART_X_ATTR,
  CHART_Y_ATTR,
  CHART_FILTER_ATTR,
} from '../sdk-patterns';

export interface ChartDataBinding {
  source: string | null;
  x: string | null;
  y: string[];
  filter: string | null;
}

export function getChartDataBinding(element: Element): ChartDataBinding {
  return {
    source: element.getAttribute(CHART_DATA_ATTR),
    x: element.getAttribute(CHART_X_ATTR),
    y: (element.getAttribute(CHART_Y_ATTR) || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    filter: element.getAttribute(CHART_FILTER_ATTR),
  };
}

export function setChartDataBinding(element: Element, binding: Partial<ChartDataBinding>): void {
  const setOrRemove = (attr: string, value: string | null | undefined) => {
    if (value) element.setAttribute(attr, value);
    else element.removeAttribute(attr);
  };
  if (binding.source !== undefined) setOrRemove(CHART_DATA_ATTR, binding.source);
  if (binding.x !== undefined) setOrRemove(CHART_X_ATTR, binding.x);
  if (binding.y !== undefined) setOrRemove(CHART_Y_ATTR, binding.y.length ? binding.y.join(',') : null);
  if (binding.filter !== undefined) setOrRemove(CHART_FILTER_ATTR, binding.filter);
}

/** Parse the data-shareout-chart JSON config, tolerant of malformed input. */
export function parseChartConfig(element: Element): Record<string, any> {
  try {
    return JSON.parse(element.getAttribute(CHART_ATTR) || '{}');
  } catch {
    return {};
  }
}

export function writeChartConfig(element: Element, config: Record<string, any>): void {
  element.setAttribute(CHART_ATTR, JSON.stringify(config));
}

/**
 * Collapse a legacy `config.dataBinding` (model B) onto the flat attrs (model A) and return the
 * config with `dataBinding` removed. The flat attrs win when both exist (model A is the truth),
 * so we only fill them from the legacy binding when no source is set yet.
 */
export function migrateLegacyDataBinding(
  config: Record<string, any>,
  element: Element,
): { config: Record<string, any>; migrated: boolean } {
  const db = config?.dataBinding;
  if (!db) return { config, migrated: false };

  if (!getChartDataBinding(element).source) {
    let source: string | null = null;
    if (db.source === 'table' && db.tableName) source = `table:${db.tableName}`;
    else if (db.source === 'json' && db.jsonKey) source = `json:${db.jsonKey}`;
    else if (db.source === 'api' && db.apiUrl) source = `api:${db.apiUrl}`;
    if (source) {
      setChartDataBinding(element, {
        source,
        x: db.xColumn || null,
        y: Array.isArray(db.yColumns) ? db.yColumns : [],
      });
    }
  }

  const { dataBinding, ...rest } = config;
  return { config: rest, migrated: true };
}
