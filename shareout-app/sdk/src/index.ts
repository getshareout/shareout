export type { ShareOutOptions, DataResponse, ViewerIdentity } from './types/common';
export { ShareOutError } from './shareout-error';
export { ShareOut } from './core/shareout';

export type {
  DatasetMetadata,
  DatasetPage,
} from './stores/dataset';

export type {
  QueryOptions,
  ProxyOptions,
  ProxyResult,
  QueryResult,
} from './stores/connection';

export type {
  PlatformConnectionInfo,
  PlatformProviderConfig,
  PlatformEndpointInfo,
  PlatformExecuteOptions,
  PlatformExecuteResult,
} from './stores/platform-store';
export { PlatformStore, PlatformProvider } from './stores/platform-store';

export type {
  JsonEntry,
  JsonSetResult,
  JsonSetOptions,
  JsonUpdateOptions,
} from './stores/json-store';

export type {
  EmailNotifyOwnerParams,
  EmailSendReportParams,
  EmailSendResult,
  EmailStatus,
} from './stores/email-store';

export type {
  InboxMessage,
  InboxAttachment,
  InboxStatus,
  InboxListOptions,
} from './stores/inbox-store';

export type {
  BlobMetadata,
  BlobUploadResult,
  BlobListResult,
  BlobStorageUsage,
} from './stores/blobs-store';

export { FilesStore } from './stores/files-store';

export type {
  PythonLoadOptions,
  PythonRunOptions,
  PythonResult,
} from './stores/python-store';

export type {
  TemplateVariable,
  EmailTemplate,
  CreateTemplateParams,
  UpdateTemplateParams,
  RenderedEmail,
} from './stores/templates-store';

export type {
  Comment,
  CommentsConfig,
  CommentEvent,
  CommentThread,
  ReactionResult,
  ReactionEvent,
} from './stores/comment-types';

export type {
  CrewToolGrant,
  CrewDefineConfig,
  CrewTriggerConfig,
  CrewConditionConfig,
  CrewRunEvent,
} from './stores/crew-store';

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
} from './stores/dashboards';

export type {
  SourceEntry,
  SourceKind,
  SourceFeed,
  SourceReplication,
  MountSourcesOptions,
  SourcesController,
} from './stores/sources-store';

export type {
  Pilot,
  PilotOptions,
  PilotResult,
} from './stores/pilot-store';

export { Grid } from './stores/grid-store';
export type {
  GridColumn,
  GridColumnType,
  GridOptions,
  GridRow,
  GridSource,
  GridLoadResult,
} from './grid/types';

export {
  clearServiceWorkerCache,
  precacheUrls,
  registerServiceWorker,
  type ServiceWorkerOptions,
  unregisterServiceWorker,
} from './service-worker';

import { ShareOut } from './core/shareout';
import type { ShareOutOptions } from './types/common';

let defaultInstance: ShareOut | null = null;

export function init(options?: ShareOutOptions): ShareOut {
  defaultInstance = new ShareOut(options);
  return defaultInstance;
}

export function getShareOut(): ShareOut {
  if (!defaultInstance) {
    defaultInstance = new ShareOut();
  }
  return defaultInstance;
}

if (typeof window !== 'undefined') {
  const script = document.currentScript;
  if (script?.hasAttribute('data-auto-init')) {
    init();
  }
  // Opt-in auto-mount of the Data sources drawer: add `data-shareout-sources` to
  // <body> (or the SDK <script>) and the provenance drawer + badges appear with no
  // extra JS. Runs after DOM ready so feed selectors resolve.
  const wantsDrawer = () =>
    document.body?.hasAttribute('data-shareout-sources') ||
    Boolean(script?.hasAttribute('data-shareout-sources'));
  const autoMount = () => {
    if (wantsDrawer()) getShareOut().sources.mount();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount, { once: true });
  } else {
    autoMount();
  }
}

export default ShareOut;
