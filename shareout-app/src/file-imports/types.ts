/**
 * Folder import from cloud drives — shared shapes and limits.
 *
 * A connection is one member's read-only consent to a provider inside one workspace.
 * A source is a remote folder mirrored into a ShareOut folder. A run is one pass over
 * a source; file_import_items records what every remote item became, so a re-run only
 * fetches what changed.
 */

export const FILE_IMPORT_PROVIDERS = ['google_drive', 'microsoft'] as const;
export type FileImportProvider = (typeof FILE_IMPORT_PROVIDERS)[number];
export const isFileImportProvider = (v: unknown): v is FileImportProvider =>
  typeof v === 'string' && (FILE_IMPORT_PROVIDERS as readonly string[]).includes(v);

export const RUN_STATUSES = ['queued', 'walking', 'importing', 'done', 'stopped', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const ACTIVE_STATUSES: readonly RunStatus[] = ['queued', 'walking', 'importing'];

export const RUN_TRIGGERS = ['manual', 'resync', 'schedule'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/** Workflow payload: everything else is read from the run row. */
export interface FileImportParams {
  runId: string;
}

/** Bounds on one source, so a mis-picked "My Drive" cannot walk forever. */
export interface WalkLimits {
  maxDepth: number;
  maxFolders: number;
  maxFiles: number;
}
export const DEFAULT_LIMITS: WalkLimits = { maxDepth: 20, maxFolders: 2_000, maxFiles: 10_000 };

/** Folders listed / files imported per durable step. Keeps a step well inside its limits. */
export const FOLDERS_PER_STEP = 10;
export const FILES_PER_STEP = 15;
/** Converted pages per run: past this the files still import, just not as live pages. */
export const MAX_CONVERSIONS_PER_RUN = 300;
/** Files up to this size are buffered (needed to convert); larger ones stream to R2. */
export const BUFFER_MAX_BYTES = 25 * 1024 * 1024;
/** A run whose row has not moved in this long is treated as dead, so a new one may start. */
export const STALE_RUN_MS = 2 * 60 * 60 * 1000;
/** Daily-sync sources started per cron tick, and allowed per workspace. */
export const SCHEDULED_SOURCES_PER_TICK = 10;
export const MAX_DAILY_SOURCES_PER_WORKSPACE = 10;

/** One entry in a remote folder listing. */
export interface RemoteEntry {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  mime?: string;
  size?: number;
  /** Changes when the content changes: Drive modifiedTime, Graph cTag (eTag fallback). */
  version?: string;
}

export interface RemoteListing {
  entries: RemoteEntry[];
  next?: string;
}

/** What a download produced, or why the file was not fetched. */
export type RemoteDownload =
  | { ok: true; filename: string; mime: string; size: number | null; body: ReadableStream<Uint8Array> }
  | { ok: false; code: string; message: string };

/** A row in the server-side folder browser. `ref` is opaque to the client. */
export interface BrowseEntry {
  ref: string;
  name: string;
  kind: 'folder' | 'drive' | 'site' | 'group';
  /** Can be picked as the folder to import. */
  selectable: boolean;
}

export interface BrowseResult {
  entries: BrowseEntry[];
  /** Whether this level accepts a search query (SharePoint sites). */
  searchable?: boolean;
}

/** Where a picked ref points: the drive (null = the user's own) and folder id. */
export interface RemoteLocation {
  driveId: string | null;
  folderId: string;
}

export interface ProviderApi {
  readonly id: FileImportProvider;
  listChildren(token: string, loc: RemoteLocation, pageToken?: string): Promise<RemoteListing>;
  download(token: string, driveId: string | null, entry: RemoteEntry): Promise<RemoteDownload>;
  browse(token: string, ref: string, query?: string): Promise<BrowseResult>;
  /** Parse a selectable browse ref into a folder location. null = not importable. */
  locate(token: string, ref: string): Promise<RemoteLocation | null>;
}
