import { ShareOutError } from '../shareout-error';
import type { ShareOutOptions, ViewerIdentity } from '../types/common';
import { parseApiResponse, wrapNetworkError } from '../internal/parse-api-response';
import { RequestDeduplicator } from '../internal/request-deduplicator';
import { SWRCache } from '../internal/swr-cache';
import { RequestBatcher } from '../internal/request-batcher';
import {
  POST_MESSAGE_INIT_TIMEOUT_MS,
  waitForPostMessageInit,
} from '../internal/embedded-init';
import {
  detectArtifactId,
  detectBaseUrl,
  getEmbeddedData,
  hydrateFromEmbedded,
  hydrateTablesFromEmbedded,
} from './detection';
import { hashQuery } from './hash-query';
import { JsonStore } from '../stores/json-store';
import { PlatformStore } from '../stores/platform-store';
import { Table } from '../stores/table-store';
import { Grid } from '../stores/grid-store';
import type { GridOptions } from '../grid/types';
import { RealtimeDoc } from '../stores/realtime-doc';
import { Dataset } from '../stores/dataset';
import { Connection } from '../stores/connection';
import { SecretsProxy } from '../stores/secrets-proxy';
import { CommentsStore } from '../stores/comments-store';
import { SheetsStore } from '../stores/sheets-store';
import { AgentStore } from '../stores/agent-store';
import { CrewStore } from '../stores/crew-store';
import { DashboardsStore } from '../stores/dashboards';
import { SlidesStore } from '../stores/slides';
import { EmailStore } from '../stores/email-store';
import { InboxStore } from '../stores/inbox-store';
import { BlobsStore } from '../stores/blobs-store';
import { FilesStore } from '../stores/files-store';
import { TemplatesStore } from '../stores/templates-store';
import { SourcesStore } from '../stores/sources-store';
import { PythonStore } from '../stores/python-store';
import { WorkspaceStore } from '../stores/workspace-store';

// --- Automatic content-ready signalling ---------------------------------------
// The viewer wrapper shows a loading skeleton until the artifact posts
// `shareout:content-ready`. So every artifact benefits without opting in, the SDK
// fires it automatically once data calls settle: after the network goes idle for
// READY_IDLE_MS, or READY_MAX_MS after the first call, whichever comes first. For
// artifacts that make no data calls (static / fully prefetched), a short
// no-activity fallback fires it. Calling ShareOut.ready() overrides all of these.
const READY_IDLE_MS = 400;
const READY_MAX_MS = 8000;
const READY_NO_ACTIVITY_MS = 1000;

let readyFired = false;
let readyInFlight = 0;
let readySawActivity = false;
let readyIdleTimer: ReturnType<typeof setTimeout> | undefined;
let readyMaxTimer: ReturnType<typeof setTimeout> | undefined;
let readyNoActivityTimer: ReturnType<typeof setTimeout> | undefined;

function clearReadyTimers(): void {
  clearTimeout(readyIdleTimer);
  clearTimeout(readyMaxTimer);
  clearTimeout(readyNoActivityTimer);
}

function fireContentReady(): void {
  if (readyFired) return;
  if (typeof window === 'undefined' || window.parent === window) return;
  readyFired = true;
  clearReadyTimers();
  try {
    window.parent.postMessage({ type: 'shareout:content-ready' }, '*');
  } catch {
    // Cross-origin / detached frame — nothing to do.
  }
}

function isEmbedded(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

function noteRequestStart(): void {
  if (readyFired || !isEmbedded()) return;
  readySawActivity = true;
  readyInFlight++;
  clearTimeout(readyIdleTimer);
  clearTimeout(readyNoActivityTimer);
  if (!readyMaxTimer) readyMaxTimer = setTimeout(fireContentReady, READY_MAX_MS);
}

function noteRequestEnd(): void {
  if (readyFired || !isEmbedded()) return;
  readyInFlight = Math.max(0, readyInFlight - 1);
  if (readyInFlight === 0) {
    clearTimeout(readyIdleTimer);
    readyIdleTimer = setTimeout(fireContentReady, READY_IDLE_MS);
  }
}

export class ShareOut {
  private artifactId: string;
  private baseUrl: string;
  private sessionToken?: string;
  private deduplicator: RequestDeduplicator;
  private cache: SWRCache;
  private batcher: RequestBatcher;
  private cacheEnabled: boolean;
  private realtimeDocs = new Map<string, RealtimeDoc>();
  /** Editor preview: serve reads from seed/empty with no network (see EmbeddedInitialData). */
  private editorMode: boolean;
  private seededTables: Record<string, { rows: unknown[]; total: number; hasMore: boolean }>;
  private seededConnections: Record<string, unknown[]>;
  /** Workspace Library: cache the resolve+import promise per module name. */
  private libCache = new Map<string, Promise<unknown>>();
  /** True once late postMessage init has been applied (or none is coming). */
  private initialized: boolean;
  /** Memoized late-init wait so only the first read pays for it. */
  private initPromise?: Promise<void>;

  static async create(options: ShareOutOptions = {}): Promise<ShareOut> {
    // The open is no longer gated on shareout:init — id resolves from the CDN
    // hostname/URL, so static artifacts render immediately. Data reads that need
    // the seeded payload/session token await init lazily via ensureEmbeddedInit().
    // Arm the no-activity fallback: if the artifact makes no data calls (static or
    // fully prefetched), still signal ready so the wrapper hides its skeleton.
    if (typeof window !== 'undefined' && window.parent !== window && !readyFired) {
      clearTimeout(readyNoActivityTimer);
      readyNoActivityTimer = setTimeout(() => {
        if (!readySawActivity) fireContentReady();
      }, READY_NO_ACTIVITY_MS);
    }
    return new ShareOut(options);
  }

  static ready(): void {
    if (typeof window === 'undefined' || window.parent === window) return;
    readyFired = true;
    clearReadyTimers();
    window.parent.postMessage({ type: 'shareout:content-ready' }, '*');
  }

  constructor(options: ShareOutOptions = {}) {
    const embedded = getEmbeddedData();

    this.artifactId = options.artifactId || embedded?.artifactId || detectArtifactId();
    this.baseUrl = options.baseUrl || embedded?.baseUrl || detectBaseUrl();
    this.sessionToken = options.sessionToken || embedded?.sessionToken;
    this.cacheEnabled = options.cache !== false;

    this.deduplicator = new RequestDeduplicator();
    this.cache = new SWRCache(options.cacheTTL ?? 60000);
    this.batcher = new RequestBatcher(this, options.batchDelay ?? 5);
    this.editorMode = embedded?.editorMode === true;
    this.seededTables = embedded?.tables ?? {};
    this.seededConnections = embedded?.connections ?? {};
    // If seeded data is already present (or we're not in a sandboxed frame that
    // receives late postMessage init), reads need not wait for anything.
    this.initialized =
      !!embedded ||
      typeof window === 'undefined' ||
      window.parent === window ||
      !!options.artifactId;

    if (embedded?.json && this.cacheEnabled) {
      hydrateFromEmbedded(this.cache, embedded.json);
    }

    if (embedded?.tables && this.cacheEnabled) {
      hydrateTablesFromEmbedded(this.cache, embedded.tables);
    }

    if (!this.artifactId) {
      if (this.editorMode) {
        // No network happens in editor preview, so a placeholder id is fine.
        this.artifactId = 'editor-preview';
      } else {
        throw new ShareOutError(
          'Could not detect artifact ID. Please provide it explicitly.',
          'INIT_ERROR',
          400
        );
      }
    }
  }

  /**
   * Editor-preview resolver: returns seeded/empty data with NO network call, so an
   * artifact that awaits SDK data on load can never hang in the visual editor.
   */
  private editorModeResult<T>(method: string, path: string, isTableQuery: boolean): T {
    if (isTableQuery) {
      const name = decodeURIComponent(path.split('/')[2] || '');
      return (this.seededTables[name] ?? { rows: [], total: 0, hasMore: false }) as T;
    }
    // Live connector queries (often the slow-loading charts/tables) → seeded sample rows
    // (manifest `sources.connections.<name>.default`), or empty. Shaped as QueryResult so
    // `conn.fetch()` returns the rows instead of throwing.
    const connMatch = method === 'POST' ? path.match(/^\/connections\/([^/]+)\/query$/) : null;
    if (connMatch) {
      const rows = this.seededConnections[decodeURIComponent(connMatch[1])] ?? [];
      return { data: rows, cached: false, executionTimeMs: 0, rowCount: rows.length } as T;
    }
    if (method === 'GET' && path.startsWith('/json/')) {
      throw new ShareOutError('Key not found', 'KEY_NOT_FOUND', 404);
    }
    if (method === 'GET') return null as T;
    // Mutations are no-ops in the editor preview — never touch live data.
    return {} as T;
  }

  /**
   * Lazily await the parent's shareout:init and apply its seeded payload/session
   * token before the first real network read. Memoized: only the first read waits,
   * and static artifacts (no reads) never pay for it — that keeps the artifact open
   * off the init critical path while still letting data-heavy artifacts resolve
   * their session/seed before fetching (avoids 401s on private reads).
   */
  private async ensureEmbeddedInit(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await waitForPostMessageInit(POST_MESSAGE_INIT_TIMEOUT_MS);
        const embedded = getEmbeddedData();
        if (embedded) {
          if (!this.sessionToken && embedded.sessionToken) {
            this.sessionToken = embedded.sessionToken;
          }
          if (embedded.json && this.cacheEnabled) {
            hydrateFromEmbedded(this.cache, embedded.json);
          }
          if (embedded.tables && this.cacheEnabled) {
            hydrateTablesFromEmbedded(this.cache, embedded.tables);
          }
          if (embedded.tables) this.seededTables = embedded.tables;
          if (embedded.connections) this.seededConnections = embedded.connections;
        }
        this.initialized = true;
      })();
    }
    return this.initPromise;
  }

  async _directFetch<T = unknown>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    await this.ensureEmbeddedInit();
    const url = `${this.baseUrl}/v1/data/${this.artifactId}${path}`;

    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');

    if (this.sessionToken) {
      headers.set('Authorization', `Bearer ${this.sessionToken}`);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });
    } catch (err) {
      throw wrapNetworkError(err);
    }

    return parseApiResponse<T>(response);
  }

  protected async _fetch<T = unknown>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    noteRequestStart();
    try {
      return await this._fetchInner<T>(path, options);
    } finally {
      noteRequestEnd();
    }
  }

  private async _fetchInner<T = unknown>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Wait for late init before touching the cache: seeded json/tables land here,
    // and reads must carry the viewer session token or private artifacts 401.
    if (!this.initialized) await this.ensureEmbeddedInit();
    const method = options.method?.toUpperCase() || 'GET';
    const body = options.body as string | undefined;

    const isTableQuery = method === 'POST' && /^\/tables\/[^/]+\/query$/.test(path);
    const cacheKey = method === 'POST' && body
      ? `${method}:${path}:${hashQuery(body)}`
      : `${method}:${path}`;

    const isCacheable = (method === 'GET' || isTableQuery) && this.cacheEnabled;

    if (isCacheable) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached) {
        if (!this.editorMode && cached.stale && !this.cache.isRevalidating(cacheKey)) {
          this.cache.startRevalidation(cacheKey);
          this.revalidateInBackground<T>(path, options, cacheKey);
        }
        return cached.data;
      }
    }

    // Editor preview: resolve everything locally, never hit the network.
    if (this.editorMode) {
      return this.editorModeResult<T>(method, path, isTableQuery);
    }

    const run = async (): Promise<T> => {
      let result: T;
      if (method === 'GET') {
        result = await this.batcher.batch<T>(path, method);
      } else {
        try {
          result = await this._directFetch<T>(path, options);
        } catch (err) {
          // Failed mutations must still drop cached reads — otherwise a CAS
          // retry (json.update) re-reads a stale pre-write value and loops forever
          // or applies the transform to outdated state.
          if (!isTableQuery) this.invalidateCacheForPath(path);
          throw err;
        }
        if (!isTableQuery) {
          this.invalidateCacheForPath(path);
        }
      }

      if (isCacheable) {
        this.cache.set<T>(cacheKey, result);
      }

      return result;
    };

    // Dedupe idempotent reads only. Collapsing two identical concurrent writes
    // (double-click, duplicate event) into one call silently drops the second.
    const isIdempotentRead = method === 'GET' || isTableQuery;
    return isIdempotentRead ? this.deduplicator.dedupe<T>(cacheKey, run) : run();
  }

  private async revalidateInBackground<T>(
    path: string,
    options: RequestInit,
    cacheKey: string
  ): Promise<void> {
    try {
      const result = await this._directFetch<T>(path, options);
      this.cache.set<T>(cacheKey, result);
    } catch {
      // Ignore revalidation errors
    } finally {
      this.cache.endRevalidation(cacheKey);
    }
  }

  private invalidateCacheForPath(path: string): void {
    if (path.startsWith('/json')) {
      this.cache.invalidatePrefix('GET:/json');
    } else if (path.startsWith('/tables')) {
      const tableName = path.split('/')[2];
      if (tableName) {
        this.cache.invalidatePrefix(`GET:/tables/${tableName}`);
        this.cache.invalidatePrefix(`POST:/tables/${tableName}`);
      }
    } else if (path.startsWith('/comments')) {
      this.cache.invalidatePrefix('GET:/comments');
    }
  }

  invalidateTableCache(tableName?: string): void {
    if (tableName) {
      this.cache.invalidatePrefix(`GET:/tables/${encodeURIComponent(tableName)}`);
      this.cache.invalidatePrefix(`POST:/tables/${encodeURIComponent(tableName)}`);
    } else {
      this.cache.invalidatePrefix('GET:/tables');
      this.cache.invalidatePrefix('POST:/tables');
    }
  }

  async prefetch(paths: string[]): Promise<void> {
    await Promise.allSettled(
      paths.map(path => this._fetch(path).catch(() => {}))
    );
  }

  clearCache(): void {
    this.cache.clear();
    this.deduplicator.clear();
  }

  get cacheStats() {
    return this.cache.stats;
  }

  get json(): JsonStore {
    return new JsonStore(this);
  }

  /**
   * Platform providers (BigQuery, Snowflake, GA, Shopify, …).
   * Prefer this over `_internalFetch('/platform/…')`.
   */
  get platform(): PlatformStore {
    return new PlatformStore(this);
  }

  table<T extends { id: string } = { id: string }>(name: string): Table<T> {
    return new Table<T>(this, name);
  }

  // Editable spreadsheet grid bound to a table (default) or a connected
  // Google Sheet. See Grid / specs/editable-grid.md.
  grid(name: string, options?: GridOptions): Grid {
    return new Grid(this, name, options);
  }

  // Workspace-shared data: read/write tables other artifacts opted into sharing,
  // and share this artifact's own tables. See WorkspaceStore.
  get workspace(): WorkspaceStore {
    return new WorkspaceStore(this);
  }

  realtime(docId: string): RealtimeDoc {
    // Memoize per docId: a fresh RealtimeDoc opens a second WebSocket to the
    // same doc, so callers that call realtime(x) twice would desync.
    let doc = this.realtimeDocs.get(docId);
    if (!doc) {
      doc = new RealtimeDoc(this, docId);
      this.realtimeDocs.set(docId, doc);
    }
    return doc;
  }

  dataset(name: string): Dataset {
    return new Dataset(this, name);
  }

  connection(name: string): Connection {
    return new Connection(this, name);
  }

  get secrets(): SecretsProxy {
    return new SecretsProxy(this);
  }

  // Workspace Library: import a private workspace/personal module by name, like a CDN
  // lib. Resolves the pinned-or-latest version for this artifact's scope, then dynamic-
  // imports the module same-origin (immutable-cached). Result is cached per name.
  //   const { bar } = await so.lib('charts');
  lib<T = Record<string, unknown>>(name: string): Promise<T> {
    let p = this.libCache.get(name) as Promise<T> | undefined;
    if (!p) {
      p = (async () => {
        const res = await this._authFetch<{ url: string }>(`/artifacts/${this.artifactId}/lib/${encodeURIComponent(name)}`);
        const base = (typeof location !== 'undefined' && location.origin) ? location.origin : this.baseUrl;
        const url = new URL(res.url, base).href;
        return import(/* @vite-ignore */ url) as Promise<T>;
      })();
      this.libCache.set(name, p);
    }
    return p;
  }

  private _commentsStore?: CommentsStore;
  get comments(): CommentsStore {
    if (!this._commentsStore) this._commentsStore = new CommentsStore(this);
    return this._commentsStore;
  }

  get sheets(): SheetsStore {
    return new SheetsStore(this);
  }

  get agent(): AgentStore {
    return new AgentStore(this);
  }

  get crew(): CrewStore {
    return new CrewStore(this);
  }

  get dashboards(): DashboardsStore {
    return new DashboardsStore(this);
  }

  get slides(): SlidesStore {
    return new SlidesStore(this);
  }

  get email(): EmailStore {
    return new EmailStore(this);
  }

  get inbox(): InboxStore {
    return new InboxStore(this);
  }

  get blobs(): BlobsStore {
    return new BlobsStore(this);
  }

  get files(): FilesStore {
    return new FilesStore(this);
  }

  get templates(): TemplatesStore {
    return new TemplatesStore(this);
  }

  // Data provenance: read the manifest's declared sources/queries/replication and
  // render the standard "Data sources" drawer + per-element "where from?" badges.
  private _sourcesStore?: SourcesStore;
  get sources(): SourcesStore {
    if (!this._sourcesStore) this._sourcesStore = new SourcesStore(this);
    return this._sourcesStore;
  }

  get python(): PythonStore {
    return new PythonStore();
  }

  /**
   * The current viewer's identity and role for this artifact, from the data the
   * platform injects at serve time (postMessage in sandboxed/cdn mode, inline
   * script otherwise). Use it to switch UI between team (owner/editor) and
   * external viewer (client) modes. Server-side permissions are always enforced
   * regardless of what this returns. Anonymous viewers resolve to role 'viewer'.
   */
  async me(): Promise<ViewerIdentity> {
    await waitForPostMessageInit();
    const data = getEmbeddedData();
    const admin = data?.admin;
    const role = (admin?.role as ViewerIdentity['role']) ?? 'viewer';
    return {
      role,
      isOwner: admin?.isOwner ?? false,
      canEdit: admin?.canEdit ?? (role === 'owner' || role === 'editor'),
      email: data?.viewer?.email ?? null,
      name: data?.viewer?.name ?? null,
    };
  }

  /**
   * Provision a sibling artifact from inside this one, authenticated by the
   * owner's data-tier identity. The new artifact is created in THIS artifact's
   * workspace (no cross-tenant), and only the owner/editor may call it — no API
   * token ever reaches the browser. Pass raw `files`, or clone a template with
   * `fromArtifact` + `replace` (server fetches the template and stamps it).
   */
  async provision(opts: {
    name: string;
    slug?: string;
    entrypoint?: string;
    visibility?: 'public' | 'workspace' | 'private';
    files?: Array<{ path: string; content: string; mime: string; encoding?: 'utf8' | 'base64' }>;
    fromArtifact?: string;
    replace?: Record<string, string>;
    agent?: unknown;
  }): Promise<{ artifact: { id: string }; deployment: { slug: string; url: string }; version: { id: string; version_no: number } }> {
    return this._internalFetch('/provision', { method: 'POST', body: JSON.stringify(opts) });
  }

  _internalFetch<T>(path: string, options?: RequestInit): Promise<T> {
    return this._fetch<T>(path, options);
  }

  async _authFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    // Editor preview: workspace/auth calls are no-ops, never hit the network.
    if (this.editorMode) {
      const method = options.method?.toUpperCase() || 'GET';
      return (method === 'GET' ? null : {}) as T;
    }
    const url = `${this.baseUrl}/v1${path}`;

    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');

    if (this.sessionToken) {
      headers.set('Authorization', `Bearer ${this.sessionToken}`);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (err) {
      throw wrapNetworkError(err);
    }

    return parseApiResponse<T>(response);
  }

  get _artifactId(): string {
    return this.artifactId;
  }

  get _baseUrl(): string {
    return this.baseUrl;
  }

  get _sessionToken(): string | undefined {
    return this.sessionToken;
  }
}
