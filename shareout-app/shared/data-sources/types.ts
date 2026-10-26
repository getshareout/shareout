/**
 * Artifact provenance: what data a published page uses, where it comes from, how fresh
 * it is, and which elements each source feeds. One shape for every surface (shared-link
 * viewer, Studio, editors, agents) — `GET /v1/artifacts/{id}/sources`.
 *
 * Every field a viewer sees is either in the page source already (manifest, bindings,
 * SDK calls) or a fact about freshness. Queries, connection identifiers and credential
 * hints live under `details`, which only editors and managers receive.
 */

export type SourceKind =
  | 'table'
  | 'json'
  | 'file'
  | 'connection'
  | 'mcp'
  | 'dataset'
  | 'knowledge'
  | 'metric'
  | 'external';

/** Who keeps a source current. `live` = read when the page loads. */
export type RefresherType = 'job' | 'crew' | 'manual' | 'live';

export interface SourceRefresher {
  type: RefresherType;
  /** The job / crew / sync name. Omitted for policy-scoped viewers and for `live`. */
  name?: string;
  /** 5-field cron (UTC) when the refresher runs on a schedule. */
  schedule?: string;
}

export interface SourceFreshness {
  /** Snapshot date the author declared in the manifest (`as_of`). */
  as_of?: string;
  /** Cadence in the author's words (`refresh`), e.g. "daily 12:00 UTC". */
  refresh?: string;
  /** Last time ShareOut saw this source written (ISO 8601). */
  last_refresh_at?: string;
  refresher?: SourceRefresher;
  /** Older than the declared `freshness_sla`, else twice the refresh schedule's interval,
   *  else a week (see src/provenance/staleness.ts). */
  stale?: boolean;
}

/** One element on the page that a source feeds. */
export interface SourceFeed {
  /** CSS selector that finds the element(s) in the rendered page. */
  selector: string;
  element_id?: string;
  /** Human label from data-shareout-display, a chart title, aria-label or a feed note. */
  label?: string;
}

export type SourceAccess = 'summary' | 'full';

/** Editor/manager-only facts. Absent from every response a viewer receives. */
export interface SourceDetails {
  query?: string;
  tables?: string[];
  replication?: { build?: string; publish?: string; credentials?: string; notes?: string };
  connection?: {
    id: string;
    name: string;
    scope: 'artifact' | 'workspace';
    kind: 'generic' | 'platform';
    credential_scope: 'shared' | 'per_user';
    /** The name resolves to nothing in this instance. */
    missing?: boolean;
  };
  /** The connection name the page or a job asks for, when no row matches it. */
  missing_connection?: string;
  refreshers?: Array<{
    type: 'job' | 'crew' | 'sync';
    id: string;
    name: string;
    schedule?: string;
    enabled: boolean;
    last_status?: string;
    last_run_at?: string;
  }>;
  /** MCP: the tools this page may call as its viewer. */
  tools?: string[];
  /** External API proxy: hosts the page may reach. */
  hosts?: string[];
  /** Where an editor manages this source. Relative app URLs. */
  manage?: { connections?: string; jobs?: string; data?: string };
}

export interface DataSource {
  /** Stable `kind:name` ref; the same string the page uses in data-shareout-source. */
  key: string;
  kind: SourceKind;
  label: string;
  /** Provider id (`bigquery`, `google-ads`, `mcp`, `shareout` for built-in stores) or null when unknown. */
  provider: string | null;
  provider_label: string | null;
  /** Only what the author declared — never generated. */
  description?: string;
  /** Declared in the manifest or publish capabilities. False = found in code, bindings or config. */
  declared: boolean;
  /** The page reads this source itself. False = it only feeds another source (`upstream`). */
  direct: boolean;
  freshness: SourceFreshness;
  feeds: SourceFeed[];
  /** Elements fed, counted before `feeds` is capped. */
  feed_count: number;
  /** Keys of the sources this one is derived from (job/crew/metric lineage). */
  upstream: string[];
  access: SourceAccess;
  details?: SourceDetails;
}

export interface SourcesResponse {
  artifact_id: string;
  /** `id` only for editors (it addresses ?version=). */
  version: { id?: string; number: number; page: string };
  access: SourceAccess;
  /** The caller's data is filtered by the artifact's access policy. */
  scoped: boolean;
  sources: DataSource[];
}

/** Per-source cap on listed feed selectors (feed_count keeps the true number). */
export const MAX_FEEDS_PER_SOURCE = 50;
