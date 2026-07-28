/**
 * Type contracts for the ShareOut Dashboards SDK.
 * Widget configs, layout, filters, data sources, and dashboard metadata.
 */

export type WidgetType = 'kpi' | 'chart' | 'table' | 'text' | 'image' | 'embed' | 'filter' | 'html';

export interface LayoutItem {
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
}

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  dataSource: string | null;
  query?: DataQuery;
  config: WidgetConfig;
  overrides?: WidgetOverrides;
  owner: string | null;
  locked: boolean;
}

export interface DataQuery {
  transform?: string;
  filter?: Record<string, unknown>;
  sort?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  groupBy?: string[];
  aggregate?: Record<string, string>;
}

export interface WidgetConfig {
  [key: string]: unknown;
}

export interface WidgetOverrides {
  background?: string;
  font?: { heading?: string; body?: string; mono?: string };
  padding?: number;
}

export interface KPIConfig extends WidgetConfig {
  value: string;
  label: string;
  format: 'number' | 'currency' | 'percent' | 'custom';
  formatOptions?: Intl.NumberFormatOptions;
  comparison?: {
    value: string;
    type: 'absolute' | 'percent';
    invertColors?: boolean;
  };
  sparkline?: {
    field: string;
    type: 'line' | 'bar' | 'area';
  };
  icon?: string;
  size?: 'sm' | 'md' | 'lg';
}

export interface ChartConfig extends WidgetConfig {
  chartType: 'line' | 'bar' | 'area' | 'pie' | 'donut' | 'scatter' | 'heatmap' | 'gauge' | 'funnel' | 'treemap';
  xAxis?: { field: string; type: 'category' | 'time' | 'value'; label?: string };
  yAxis?: { field: string; label?: string; min?: number; max?: number };
  series?: { field: string; name?: string; color?: string }[];
  nameField?: string;
  valueField?: string;
  legend?: { show: boolean; position: 'top' | 'bottom' | 'left' | 'right' };
  tooltip?: { show: boolean };
  animation?: boolean;
  echartsOptions?: Record<string, unknown>;
}

export interface TableConfig extends WidgetConfig {
  columns: TableColumn[];
  pageSize?: number;
  sortable?: boolean;
  filterable?: boolean;
  exportable?: boolean;
  selectable?: boolean;
  condensed?: boolean;
  striped?: boolean;
}

export interface TableColumn {
  field: string;
  header: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  format?: 'text' | 'number' | 'currency' | 'percent' | 'date' | 'boolean' | 'link' | 'image' | 'badge';
  formatOptions?: Record<string, unknown>;
  sortable?: boolean;
  filterable?: boolean;
  render?: string;
}

export interface TextConfig extends WidgetConfig {
  content: string;
  contentType: 'markdown' | 'html';
  align?: 'left' | 'center' | 'right';
  padding?: number;
}

export interface HTMLWidgetConfig extends WidgetConfig {
  content: string;
  scripts?: boolean;
}

export type DataSourceType =
  | 'static'
  | 'api'
  | 'sql'
  | 'shareout'
  | 'dataset'
  | 'csv'
  | 'websocket';

/** Table query API hard limit for a single find() page. */
export const SHAREOUT_TABLE_QUERY_LIMIT = 1000;

export interface DataSource {
  id: string;
  name: string;
  type: DataSourceType;
  config: DataSourceConfig;
  refreshInterval?: number;
  lastRefreshed?: string;
  /** True when the last refresh hit a known row cap (e.g. table limit 1000). */
  truncated?: boolean;
  /** Human-readable note from the last refresh (truncation, empty, etc.). */
  lastWarning?: string | null;
}

export interface DataSourceConfig {
  data?: unknown[];
  url?: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  connectionId?: string;
  query?: string;
  tableId?: string;
  /** Artifact dataset name for type: 'dataset' (R2 extract via sdk.dataset). */
  datasetName?: string;
  /**
   * Optional row cap for dataset sources. When set, uses server-side page()
   * instead of loading the whole extract. When result.length === limit, truncated.
   */
  limit?: number;
  blobId?: string;
}

export type FilterValue = string | string[] | { from: string; to: string } | { min: number; max: number };

export interface FilterState {
  [filterId: string]: FilterValue;
}

export interface FilterDefinition {
  id: string;
  type: 'select' | 'multiselect' | 'daterange' | 'numberrange' | 'search';
  label: string;
  dataSource?: string;
  field?: string;
  options?: { value: string; label: string }[];
  defaultValue?: FilterValue;
  affects: string[];
}

export interface FilterPreset {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  filters: FilterState;
  isDefault: boolean;
  isPinned: boolean;
  isShared: boolean;
  createdBy: string;
  createdAt: string;
}

export interface InteractionConfig {
  id: string;
  trigger: {
    widgetId: string;
    event: 'click' | 'select' | 'hover';
    field?: string;
  };
  action: {
    type: 'filter' | 'navigate' | 'highlight' | 'custom';
    target: string | string[];
    config: Record<string, unknown>;
  };
}

export interface DashboardMeta {
  id: string;
  title: string;
  description: string;
  layout: 'fixed' | 'responsive';
  columns: number;
  rowHeight: number;
  gap: number;
  padding: number;
  defaultFont: { heading: string; body: string; mono: string };
  defaultColors: {
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    accent: string;
    positive: string;
    negative: string;
    neutral: string;
  };
  refreshInterval: number | null;
  timezone: string;
  dateFormat: string;
  numberFormat: { locale: string; currency?: string };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardInfo {
  id: string;
  title: string;
  description: string;
  widgetCount: number;
  editorUrl: string;
  publishedUrl: string;
  visibility: 'public' | 'private';
  createdAt: string;
  updatedAt: string;
}

export interface DashboardCreateOptions {
  title: string;
  description?: string;
  template?: string;
  layout?: 'fixed' | 'responsive';
  columns?: number;
  rowHeight?: number;
  visibility?: 'public' | 'private';
}

export interface DashboardCreateResult {
  id: string;
  editorUrl: string;
  publishedUrl: string;
  editorArtifactId: string;
  publishedArtifactId: string;
}

export interface DashboardPresentationState {
  isPresenting: boolean;
  presenterId: string | null;
  presenterName: string | null;
  focusedWidgetId: string | null;
  startedAt: number | null;
  countdown: { total: number; remaining: number; paused: boolean } | null;
  cycling: { active: boolean; currentIndex: number; widgetIds: string[] } | null;
  pointer: { enabled: boolean; position: { x: number; y: number } | null };
}

export interface DashboardPresenceState {
  user: { id: string; name: string; color: string };
  viewingWidgetId: string | null;
  editingWidgetId: string | null;
  selectedWidgetIds: string[];
  cursor: { x: number; y: number } | null;
  pointer: { x: number; y: number } | null;
  mode: 'edit' | 'view' | 'configure' | 'present';
  lastActive: number;
}

export interface DashboardVersion {
  id: string;
  dashboardId: string;
  name: string;
  description: string | null;
  widgetCount: number;
  createdAt: string;
  createdBy: { id: string; name: string; email: string };
  isAutoSave: boolean;
  thumbnail: string | null;
}
