/**
 * ShareOut Dashboards SDK module.
 *
 * ## Architecture
 *
 * ```
 * DashboardsStore          ← sdk.dashboards (REST + session factory)
 *   └── Dashboard          ← live session (one per open/view)
 *         ├── meta         ← title, theme, layout settings
 *         ├── widgets      ← KPI, chart, table, … instances
 *         ├── layout       ← grid positions
 *         ├── dataSources  ← static, API, SQL, tables, datasets
 *         ├── filters      ← cross-widget filter state
 *         ├── presets      ← saved filter bookmarks
 *         ├── interactions ← click → filter / navigate / highlight
 *         ├── presenter    ← presentation mode
 *         ├── versions     ← server snapshots
 *         ├── publish      ← visibility + public URL
 *         └── presence     ← collaborative cursors
 * ```
 *
 * Each sub-manager maps to a fragment of the Yjs realtime doc (`dashboard-{id}`).
 * {@link DashboardHelpers} provides client-side formatting utilities with no doc state.
 */

export { DashboardsStore } from './dashboards-store';
export { Dashboard } from './dashboard';
export { DashboardHelpers } from './helpers';

export { SHAREOUT_TABLE_QUERY_LIMIT } from './types';

export type {
  WidgetType,
  LayoutItem,
  Widget,
  DataQuery,
  WidgetConfig,
  WidgetOverrides,
  KPIConfig,
  ChartConfig,
  TableConfig,
  TableColumn,
  TextConfig,
  HTMLWidgetConfig,
  DataSourceType,
  DataSource,
  DataSourceConfig,
  FilterValue,
  FilterState,
  FilterDefinition,
  FilterPreset,
  InteractionConfig,
  DashboardMeta,
  DashboardInfo,
  DashboardCreateOptions,
  DashboardCreateResult,
  DashboardPresentationState,
  DashboardPresenceState,
  DashboardVersion,
} from './types';
