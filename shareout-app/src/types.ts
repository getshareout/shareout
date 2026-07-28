import type { ReadinessProfile } from '../shared/editor-readiness/model';

/** A single artifact page-view, enqueued by trackPageView and flushed to
 *  analytics_events in batches by the queue consumer (opt-006). id + created_at are
 *  generated at enqueue time so at-least-once retries are idempotent (INSERT OR IGNORE
 *  on the id PK) and day-bucketing reflects view time, not consume time. */
export interface ViewEventMessage {
  id: string;
  artifact_id: string;
  visitor_hash: string;
  created_at: string;
  user_agent: string;
  referrer: string;
  country: string;
  path: string;
}

/** Payload delivered with the `email.received` event when an inbound message lands
 *  in an artifact's inbox. Threaded through emitJobEvent → runEventTriggeredJobs →
 *  the delivery context so destinations/crews can act on the email. */
export interface EmailReceivedPayload {
  /** Our inbox_messages.id (MiniDB primary key). */
  messageId: string;
  /** RFC Message-ID header, when present. */
  rfcMessageId: string | null;
  from: string;
  to: string;
  /** Resolved inbox prefix (the part before any +tag and the @). */
  prefix: string;
  /** Plus-address tag, e.g. "expensas" in expensas+enero@… → "enero". */
  tag: string | null;
  subject: string | null;
  /** First ~2KB of the text body for quick template use. */
  textPreview: string;
  hasHtml: boolean;
  attachments: { filename: string; contentType: string; size: number }[];
  auth: { spf: string | null; dkim: string | null; dmarc: string | null };
  receivedAt: number;
}

export interface Env {
  /** debug | info | warn | error — controls server log verbosity in Workers Logs */
  LOG_LEVEL?: string;
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  /** Cloudflare Email Service Workers binding */
  EMAIL?: SendEmail;
  SLUGS?: KVNamespace;
  SHAREOUT_BASE_URL: string;
  /** Origin untrusted artifacts are served from. Defaults to SHAREOUT_BASE_URL's origin; flip to the dedicated content domain (shareoutcdn.site) before public launch (ADR 30). */
  ARTIFACT_ORIGIN?: string;
  /** Default From address when artifact has no custom prefix (e.g. noreply@shareout.site) */
  EMAIL_DEFAULT_FROM?: string;
  /** Domain for per-artifact senders (e.g. slug@artifacts.shareout.site) */
  EMAIL_ARTIFACTS_DOMAIN?: string;
  /** Domain for inbound artifact inboxes (e.g. slug@inbox.shareout.site). Distinct
   *  from the outbound sender domain so apex mailboxes (ceo@shareout.site) are never
   *  touched by the inbound catch-all. Defaults to inbox.shareout.site. */
  EMAIL_INBOX_DOMAIN?: string;
  /** Shared secret for the /v1/webhooks/email-events delivery-event webhook. When
   *  unset the webhook is open (dev); set in prod to authenticate the sender. */
  EMAIL_WEBHOOK_SECRET?: string;
  /** When truthy (1|true|yes|on), block creation of brand-new accounts. Existing users can still log in. */
  SIGNUPS_PAUSED?: string;
  /** When truthy (1|true|yes|on), return 404 for US visitors on the apex marketing homepage (`/`). Off by default. */
  MARKETING_US_BLOCKED?: string;
  /** When truthy (1|true|yes|on), hide the entire apex marketing surface (Pages proxy, landing, pricing, create/teams funnels). */
  MARKETING_PAGES_DISABLED?: string;
  /** Optional hostname of a separate marketing site (Cloudflare Pages, Vercel, …).
   *  Unset (self-host default) = no marketing site: anonymous `/` goes to the login
   *  page and other unclaimed apex paths get the worker's 404. */
  MARKETING_ORIGIN?: string;
  /** Optional docs host served by this worker's route (e.g. docs.example.com). Requires DOCS_ORIGIN. */
  DOCS_HOST?: string;
  /** Optional hostname the docs site is deployed to (e.g. my-docs.pages.dev). Requires DOCS_HOST.
   *  Unset = no docs proxying; build `docs-site/` and host it wherever you like. */
  DOCS_ORIGIN?: string;
  /** Super-admin email for self-host first boot (in addition to superadmin-recipients.json). */
  SETUP_ADMIN_EMAIL?: string;
  /**
   * Comma-separated emails with instance-admin access to `/admin`. The self-host way
   * to add an owner — no source edit, no fork.
   */
  INSTANCE_ADMIN_EMAILS?: string;
  /** When truthy, skip CEO/ops Telegram admin alerts (self-host / empty roster). */
  ADMIN_ALERTS_DISABLED?: string;
  /** Instance-wide storage cap per workspace/user, in bytes. Unset or 0 = unlimited. */
  STORAGE_QUOTA_BYTES?: string;
  /** Instance-wide single-file cap, in bytes. Unset or 0 = unlimited. */
  STORAGE_MAX_FILE_BYTES?: string;
  /** Max public artifacts per account (anti-abuse). Unset or 0 = unlimited. */
  PUBLIC_ARTIFACT_LIMIT?: string;
  /**
   * Daily estimated egress per owner, in bytes. Over it, that owner's public
   * artifacts are auto-paused. Unset or 0 = no cap, the default — the egress is
   * billed to whoever runs the instance, so capping it is their call.
   */
  DAILY_BANDWIDTH_BYTES_PER_OWNER?: string;
  /** "1" to inject the "Made with ShareOut" badge into public artifacts. Off by default. */
  ARTIFACT_BADGE?: string;
  /** When truthy (1|true|yes|on), pause ALL lifecycle emails (incl. OTP/invites). Jobs + CrewAI email_send still work. */
  LIFECYCLE_EMAILS_DISABLED?: string;
  /** When truthy (1|true|yes|on), disable "open" visibility (public). Every artifact stays private; share via email/password/auth. */
  OPEN_VISIBILITY_DISABLED?: string;
  /** Comma-separated workspace slugs exempt from OPEN_VISIBILITY_DISABLED — public showcase/marketing galleries. */
  PUBLIC_SHOWCASE_WORKSPACES?: string;
  /** Gradual public-artifacts rollout: comma-separated user ids always allowed open visibility (allowlist wave). */
  PUBLIC_ROLLOUT_USERS?: string;
  /** Gradual public-artifacts rollout: 0–100. A user is in the rollout when their deterministic bucket < this. Set 0 to kill the wave. */
  PUBLIC_ROLLOUT_PCT?: string;
  /** Cloudflare Turnstile site key (public) injected into the signup/login widget. */
  TURNSTILE_CLOUDFLARE_SITEKEY?: string;
  /** Cloudflare Turnstile secret key for server-side siteverify (never sent to the browser). */
  TURNSTILE_CLOUDFLARE_SECRETKEY?: string;
  /** Auto-rollback threshold: abuse reports in 24h that trip the public-rollout kill switch. Default 50. */
  PUBLIC_ABUSE_AUTOKILL_PER_DAY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  TIENDANUBE_CLIENT_ID: string;
  TIENDANUBE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  /** Signing secret for Slack Events API, slash commands, and interactivity. */
  SLACK_SIGNING_SECRET?: string;
  SESSION_SECRET: string;
  CREDENTIALS_KEY?: string;
  /** R2 S3-API credentials for presigned direct-to-bucket up/downloads. When unset, byte transfers fall back to the Worker-proxied path. */
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;
  /** Defaults to the ARTIFACTS bucket name (shareout-artifacts). */
  R2_BUCKET?: string;
  REALTIME: DurableObjectNamespace;
  COMMENTS: DurableObjectNamespace;
  /** Per-artifact mini-store (json/tables) backend — SQLite-in-DO (ADR 28). */
  MINIDB: DurableObjectNamespace;
  /** Per-Telegram-chat coordinator: serializes turns, dedups updates, holds history. */
  CHAT?: DurableObjectNamespace;
  /** Per-artifact live-presence gauge: counts concurrent viewers from heartbeats. */
  PRESENCE: DurableObjectNamespace;
  /** Demo pitch-choreography runner: replays a scenario timeline via alarms (work/044 §6). */
  SHOWTIME: DurableObjectNamespace;
  /** Workers Static Assets binding — serves build artifacts (editor bundle, etc.)
   *  out of the worker script bundle (plan §19 Phase 4). */
  ASSETS: Fetcher;
  /** Cloudflare deployment version metadata — surfaces the current release id in the UI footer. */
  CF_VERSION_METADATA?: { id: string; tag?: string };
  /** Workers AI — text embeddings for semantic artifact search. Optional: code falls back to keyword search when absent. */
  AI?: Ai;
  /** Vectorize index over artifact embeddings. Optional: semantic search degrades to keyword when absent. */
  VECTORIZE?: VectorizeIndex;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  VERCEL_AI_GATEWAY?: string;
  /** Gateway model slug for the create-page build agent. Defaults to anthropic/claude-sonnet-4.6. */
  BUILD_MODEL?: string;
  /** Server-side model override for the in-page pilot LLM proxy. Defaults to the provider config model. */
  PILOT_MODEL?: string;
  /** Optional Brave Search API key for the Crew web_search tool. When unset, web_search falls back to keyless DuckDuckGo. */
  BRAVE_SEARCH_API_KEY?: string;
  RATE_LIMIT_KV?: KVNamespace;
  PROXY_CACHE?: KVNamespace;
  /** Telegram bot token (from BotFather) for the artifact chat bot. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Telegram bot token for the internal super-admin bot (CEO brief, ops). Falls back to TELEGRAM_BOT_TOKEN. */
  TELEGRAM_ADMIN_BOT_TOKEN?: string;
  /** Shared Bearer secret for the worker-to-worker admin bridge (/internal/admin/*), called by the headless-email bot. */
  ADMIN_BRIDGE_SECRET?: string;
  /** Shared secret echoed by Telegram in X-Telegram-Bot-Api-Secret-Token to authenticate webhook calls. */
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Shared secret for the trusted support email-gateway ingest (AgentsEmail → /v1/support/ingest/email). */
  SUPPORT_INGEST_KEY?: string;
  /** Cloudflare account id + API token (Analytics:Read) for infra cost monitoring in the admin portal. Optional. */
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  /** Telegram chat id that receives ops/health alerts. When unset, alerts resolve to the superadmin's linked chat from messaging_links. Optional override. */
  ALERT_TELEGRAM_CHAT_ID?: string;
  /** Cost threshold (USD, 30d) above which a workspace appears in the daily cost digest. Default 1.0. */
  COST_ALERT_THRESHOLD_USD?: string;
  /** Browser Rendering binding — headless Chromium for artifact preview screenshots. */
  BROWSER?: Fetcher;
  /** Cloudflare Queue for batched analytics view-event ingest (opt-006). When unset,
   *  trackPageView falls back to a synchronous D1 INSERT (rollback/dev path). */
  VIEWS_QUEUE?: Queue<ViewEventMessage>;
}

// 'unlisted' was retired 2026-07 and folded into 'public'. Legacy API input and
// pre-migration rows are normalized to 'public' — see normalizeVisibility.
export type Visibility = 'public' | 'workspace' | 'private';
export type FolderVisibility = 'inherit' | 'public' | 'workspace' | 'private';
export type AuthMethod = 'google' | 'password' | 'credentials';
export type CollaboratorRole = 'owner' | 'editor' | 'viewer';
export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type ArtifactType = 'html' | 'csv' | 'txt' | 'markdown' | 'json' | 'pdf' | 'image' | 'video' | 'skill' | 'library';

export interface CsvTypeMetadata {
  hasHeaders: boolean;
  delimiter: string;
  columns: Array<{ name: string; type: 'string' | 'number' | 'date' | 'boolean' }>;
  rowCount: number;
}

export interface MarkdownTypeMetadata {
  toc: Array<{ level: number; text: string; anchor: string }>;
  hasCodeBlocks: boolean;
  frontmatter?: Record<string, unknown>;
}

export interface JsonTypeMetadata {
  schema: 'object' | 'array' | 'primitive';
  rootKeys?: string[];
  isFormatted: boolean;
  itemCount?: number;
}

export interface TxtTypeMetadata {
  lineCount: number;
  encoding: string;
  charCount: number;
}

export interface PdfTypeMetadata {
  pageCount?: number;
  hasText?: boolean;
  title?: string;
  author?: string;
}

export interface ImageTypeMetadata {
  width?: number;
  height?: number;
  format: string;
}

export interface VideoTypeMetadata {
  duration?: number;
  width?: number;
  height?: number;
  format: string;
}

// Skill Marketplace: a skill is a markdown artifact with marketplace props layered
// on top of the standard markdown metadata (TOC, code blocks, frontmatter).
export interface SkillTypeMetadata extends MarkdownTypeMetadata {
  summary?: string;
  category?: string;
  tags?: string[];
  version?: string;
}

// Workspace Library: a library module is a markdown artifact (the README) carrying
// module props on top of the standard markdown metadata. name/version/main/exports are
// supplied explicitly in the publish body (not parsed from the README); namespace/scope
// are resolved server-side from the target (workspace slug or owner handle).
export interface LibraryTypeMetadata extends MarkdownTypeMetadata {
  name?: string;          // module name, e.g. "charts"
  scope?: 'personal' | 'workspace';
  namespace?: string;     // URL handle the module serves under
  version?: string;       // semver
  main?: string;          // served JS file path within the version
  exports?: string[];     // api surface (export names) — discovery + agent injection
}

export interface TypeMetadata {
  csv?: CsvTypeMetadata;
  markdown?: MarkdownTypeMetadata;
  json?: JsonTypeMetadata;
  txt?: TxtTypeMetadata;
  pdf?: PdfTypeMetadata;
  image?: ImageTypeMetadata;
  video?: VideoTypeMetadata;
  skill?: SkillTypeMetadata;
  library?: LibraryTypeMetadata;
  // AI enrichment for Files (work/042 P4) — summary + tags of the latest version.
  enrichment?: {
    status: 'ok' | 'unsupported' | 'failed';
    summary?: string;
    tags?: string[];
    blobId: string;
    model?: string;
    at: string;
  };
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string | null;
  allowed_email_domains: string | null;
  allowed_emails: string | null;
}

export interface WorkspaceAccessPolicy {
  allowed_domains: string[];
  allowed_emails: string[];
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  invited_by: string | null;
  created_at: string;
}

export interface Folder {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  visibility: FolderVisibility;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Credential {
  user: string;
  password: string;
}

export interface PWAConfig {
  enabled: boolean;
  name: string;
  short_name: string;
  description?: string;      // App description for manifest
  icon: string;              // Base64 encoded 512x512 PNG
  theme_color?: string;      // Default: #3b82f6
  background_color?: string; // Default: #ffffff
  display?: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser';
  orientation?: 'any' | 'portrait' | 'landscape';
  start_url?: string;
  offline?: {
    enabled?: boolean;
    strategy?: 'cache-first' | 'network-first';
    cacheName?: string;
    assets?: string[];
  };
}

export interface PublishRequest {
  name: string;
  slug?: string;
  entrypoint?: string;
  files: FileEntry[];
  private?: boolean;
  visibility?: Visibility;
  share_with?: string[];
  password?: string;
  credentials?: Credential[];
  workspace_id?: string;
  folder_id?: string;
  // Mobile support
  mobile_html?: string;           // Mobile-specific HTML content
  mobile_entrypoint?: string;     // Mobile entrypoint file (default: index.html)
  pwa?: PWAConfig;                // PWA configuration
  access_policy?: unknown;        // Row-level access policy (0042)
  // AI chat agent — enable + configure at publish time (no separate config call)
  agent?: AgentPublishConfig;
  // Artifact type (auto-detected if not specified)
  artifact_type?: ArtifactType;
  // Skill Marketplace: skill artifact ids to attach to this (non-skill) artifact at
  // publish time, version-pinned. The authoring agent loads them into its context.
  attached_skill_ids?: string[];
  // Workspace Library (artifact_type='library'): module metadata supplied explicitly.
  // `main` is the served JS file (default 'index.js'); `version` is a required semver.
  library?: LibraryPublishConfig;
}

export interface LibraryPublishConfig {
  name?: string;        // module name; defaults to the artifact slug
  version: string;      // semver — required, immutable once published
  main?: string;        // served JS file path within files (default 'index.js')
  exports?: string[];   // api surface (export names)
}

// Agent config accepted in a publish payload. Lets owners turn the visitor chat
// agent on and set its prompt/model in one step instead of a separate
// PUT /v1/data/:id/agent/config call.
export interface AgentPublishConfig {
  enabled?: boolean;            // turn the visitor agent on/off (default: true when this block is present)
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  contextJson?: boolean;        // include sdk.json in context (default: true)
  contextTables?: string[];     // table names to include in context
  contextBlobs?: boolean;       // include blob URLs in context
}

export interface FileEntry {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
  mime: string;
}

export interface PublishResponse {
  artifact: { id: string; type: ArtifactType };
  version: { id: string; version_no: number };
  deployment: {
    slug: string;
    url: string;                 // canonical /a/<routing-slug>/ (internal routing key for workspace artifacts)
    subdomain_url?: string;      // workspace artifacts: clean <workspace>.shareout.site/<slug>/ — the share URL
    namespaced_url?: string;
    mobile_url?: string;         // URL with ?v=mobile
    embed_url?: string;          // URL for iframe embedding
  };
  pwa?: {
    manifest_url: string;
    service_worker_url: string;
    installable: boolean;
  };
  /** Graded editor-readiness profile (HTML artifacts only). */
  editor_readiness?: ReadinessProfile;
  /** Present only when the publish-time safety check held the artifact (Workstream B):
   *  the publish succeeded but the artifact was forced private pending review / blocked. */
  moderation?: {
    status: 'pending' | 'blocked';
    message: string;
    /** Classifier/heuristic reason (short) — why it was held. */
    reason?: string;
    /** Always true when this object is present (artifact visibility forced private). */
    forced_private?: boolean;
    /** The visibility the publish asked for before the hold (restored on approval). */
    requested_visibility?: Visibility;
  };
  /** Human-readable note when the requested visibility was downgraded (e.g. no
   *  verified email, or public-artifact cap reached) — Workstream F. */
  notice?: string;
  /** True when the published visibility is more private than the caller requested
   *  (email gate, public rollout not enabled, cap reached, external author). Lets an
   *  agent detect the downgrade without parsing `notice` prose. */
  visibility_downgraded?: boolean;
  /** The visibility the caller asked for, when it differs from what was applied. */
  requested_visibility?: Visibility;
  /** The visibility actually applied to the published artifact. */
  visibility?: Visibility;
  /** Set when a workspace requires approval to publish openly: the artifact was kept
   *  workspace-visible and the requester must nominate `required` approvers. */
  approval_required?: { required: number; artifact_id: string };
  /** Present when Artifact Tests are in BLOCK mode and held this version as a
   *  candidate: the published version is NOT live yet — it goes live only if its
   *  tests pass; until then the previous version keeps serving. */
  tests?: { mode: 'block'; pending: boolean };
}

export interface ApiError {
  error: string;
  code: string;
  details?: string[];
}

export interface DataResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  hint?: string;
  suggestion?: string;
  param?: string;
  docs?: string;
}

export interface DataError {
  code: string;
  message: string;
  status: number;
  hint?: string;
  suggestion?: string;
  param?: string;
  docs?: string;
}

export const DATA_ERRORS = {
  // Authentication & Authorization
  ARTIFACT_NOT_FOUND: {
    code: 'ARTIFACT_NOT_FOUND',
    message: 'Artifact not found',
    status: 404,
    hint: 'The artifact ID or slug does not exist or has been deleted.',
    suggestion: 'Verify the artifact ID/slug is correct. Use GET /v1/artifacts to list your artifacts.',
  },
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    message: 'Authentication required',
    status: 401,
    hint: 'This endpoint requires authentication.',
    suggestion: 'Include a valid Bearer token in the Authorization header, or sign in to this instance.',
  },
  FORBIDDEN: {
    code: 'FORBIDDEN',
    message: 'Access denied',
    status: 403,
    hint: 'You do not have permission to access this resource.',
    suggestion: 'Request access from the artifact owner or check your access token permissions.',
  },

  // Request Validation
  INVALID_REQUEST: {
    code: 'INVALID_REQUEST',
    message: 'Invalid request',
    status: 400,
    hint: 'The request body or parameters are malformed.',
    suggestion: 'Check the request format matches the expected schema.',
  },
  INVALID_JSON: {
    code: 'INVALID_JSON',
    message: 'Invalid JSON body',
    status: 400,
    hint: 'The request body is not valid JSON.',
    suggestion: 'Ensure Content-Type is application/json and the body is properly formatted JSON.',
  },
  METHOD_NOT_ALLOWED: {
    code: 'METHOD_NOT_ALLOWED',
    message: 'Method not allowed',
    status: 405,
    hint: 'This HTTP method is not supported for this endpoint.',
    suggestion: 'Check the API documentation for supported methods.',
  },

  // Resource Errors
  NOT_FOUND: {
    code: 'NOT_FOUND',
    message: 'Resource not found',
    status: 404,
    hint: 'The requested resource does not exist.',
    suggestion: 'Verify the resource ID or path is correct.',
  },
  CONFLICT: {
    code: 'CONFLICT',
    message: 'Resource conflict',
    status: 409,
    hint: 'The resource already exists or conflicts with existing data.',
    suggestion: 'Use a different name/identifier, or update the existing resource instead.',
  },

  // Storage & Limits
  STORAGE_LIMIT_EXCEEDED: {
    code: 'STORAGE_LIMIT_EXCEEDED',
    message: 'Storage limit exceeded',
    status: 413,
    hint: 'You have reached the maximum storage allowed for this artifact.',
    suggestion: 'Delete unused files or contact support to increase your limit.',
  },
  FILE_TOO_LARGE: {
    code: 'FILE_TOO_LARGE',
    message: 'File too large',
    status: 413,
    hint: 'The uploaded file exceeds the maximum allowed size.',
    suggestion: 'Reduce file size or split into smaller files.',
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    message: 'Rate limit exceeded',
    status: 429,
    hint: 'Too many requests in a short period.',
    suggestion: 'Wait before retrying. Implement exponential backoff in your client.',
  },

  // Server Errors
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    message: 'Internal error',
    status: 500,
    hint: 'An unexpected error occurred on the server.',
    suggestion: 'Retry the request. If the problem persists, contact support.',
  },
  CONFIG_ERROR: {
    code: 'CONFIG_ERROR',
    message: 'Server configuration error',
    status: 500,
    hint: 'The server is missing required configuration.',
    suggestion: 'Contact the artifact owner or ShareOut support.',
  },

  // JSON Store Specific
  KEY_NOT_FOUND: {
    code: 'KEY_NOT_FOUND',
    message: 'Key not found',
    status: 404,
    hint: 'The specified key does not exist in the JSON store.',
    suggestion: 'Use HEAD /json/{key} to check if a key exists before reading. Use GET /json to list all keys.',
  },
  KEY_INVALID: {
    code: 'KEY_INVALID',
    message: 'Invalid key format',
    status: 400,
    hint: 'Keys must be alphanumeric with underscores, hyphens, or dots (max 256 chars).',
    suggestion: 'Use only: a-z, A-Z, 0-9, _, -, . Example: "user_settings", "config.v2"',
    param: 'key',
  },
  VALUE_TOO_LARGE: {
    code: 'VALUE_TOO_LARGE',
    message: 'Value too large',
    status: 400,
    hint: 'The JSON value exceeds the maximum size (1MB).',
    suggestion: 'Split large data across multiple keys or use the blobs tier for binary data.',
  },
  KEY_LIMIT_EXCEEDED: {
    code: 'KEY_LIMIT_EXCEEDED',
    message: 'Maximum keys per artifact reached',
    status: 400,
    hint: 'You have reached the maximum number of keys (1000) for this artifact.',
    suggestion: 'Delete unused keys with DELETE /json/{key}.',
  },
  VERSION_CONFLICT: {
    code: 'VERSION_CONFLICT',
    message: 'JSON key was modified concurrently',
    status: 409,
    hint: 'Another writer changed this key since you last read it (If-Match / If-None-Match failed).',
    suggestion: 'Re-read the key (getEntry) and retry, or use sdk.json.update() which retries automatically.',
  },

  // Blobs Specific
  BLOB_NOT_FOUND: {
    code: 'BLOB_NOT_FOUND',
    message: 'Blob not found',
    status: 404,
    hint: 'The specified blob ID does not exist.',
    suggestion: 'Use GET /blobs to list all blobs and verify the ID.',
  },
  BLOB_LIMIT_EXCEEDED: {
    code: 'BLOB_LIMIT_EXCEEDED',
    message: 'Maximum blobs per artifact reached',
    status: 400,
    hint: 'You have reached the maximum number of blobs (1000) for this artifact.',
    suggestion: 'Delete unused blobs with DELETE /blobs/{id}.',
  },
  INVALID_FILENAME: {
    code: 'INVALID_FILENAME',
    message: 'Invalid filename',
    status: 400,
    hint: 'Filename contains invalid characters or is too long.',
    suggestion: 'Use alphanumeric characters, spaces, underscores, hyphens, dots, parentheses, or brackets (max 255 chars).',
    param: 'filename',
  },
  INVALID_MIME_TYPE: {
    code: 'INVALID_MIME_TYPE',
    message: 'File type not allowed',
    status: 400,
    hint: 'This MIME type is not supported.',
    suggestion: 'Allowed types: images (image/*), videos (video/*), audio (audio/*), PDF, TXT, CSV, Markdown.',
    param: 'mimeType',
  },
  UPLOAD_TOKEN_INVALID: {
    code: 'UPLOAD_TOKEN_INVALID',
    message: 'Invalid or expired upload token',
    status: 400,
    hint: 'The upload token is invalid, expired, or already used.',
    suggestion: 'Request a new upload URL via POST /blobs/upload.',
  },
  UPLOAD_TOKEN_EXPIRED: {
    code: 'UPLOAD_TOKEN_EXPIRED',
    message: 'Upload token expired',
    status: 400,
    hint: 'Upload tokens expire after 15 minutes.',
    suggestion: 'Request a new upload URL and complete the upload within 15 minutes.',
  },

  // Tables Specific
  TABLE_LIMIT_EXCEEDED: {
    code: 'TABLE_LIMIT_EXCEEDED',
    message: 'Maximum tables per artifact reached',
    status: 400,
    hint: 'You have reached the maximum number of tables (50) for this artifact.',
    suggestion: 'Delete unused tables with DELETE /tables/{name}?confirm=true.',
  },
  ROW_LIMIT_EXCEEDED: {
    code: 'ROW_LIMIT_EXCEEDED',
    message: 'Maximum rows per table reached',
    status: 400,
    hint: 'This table has reached its row limit (100,000 rows).',
    suggestion: 'Delete old rows or archive data to a dataset.',
  },
  ROW_NOT_FOUND: {
    code: 'ROW_NOT_FOUND',
    message: 'Row not found',
    status: 404,
    hint: 'The specified row ID does not exist in this table.',
    suggestion: 'Use POST /tables/{name}/query to find rows matching your criteria.',
  },
  ROW_TOO_LARGE: {
    code: 'ROW_TOO_LARGE',
    message: 'Row data too large',
    status: 400,
    hint: 'Individual rows cannot exceed 100KB.',
    suggestion: 'Store large text in blobs and reference by ID, or split data across multiple rows.',
  },
  INVALID_TABLE_NAME: {
    code: 'INVALID_TABLE_NAME',
    message: 'Invalid table name',
    status: 400,
    hint: 'Table names must start with a letter and contain only letters, numbers, and underscores (max 64 chars).',
    suggestion: 'Example valid names: "users", "order_items", "ConfigV2".',
    param: 'tableName',
  },
  TABLE_WRITE_FORBIDDEN: {
    code: 'TABLE_WRITE_FORBIDDEN',
    message: 'Not allowed to write rows on this table',
    status: 403,
    hint: 'The table write role in the artifact manifest forbids this identity.',
    suggestion: 'Use an owner or editor session, or set sources.tables.<name>.write to a lower bar in the manifest.',
  },
  INVALID_FILTER: {
    code: 'INVALID_FILTER',
    message: 'Invalid filter syntax',
    status: 400,
    hint: 'The filter object contains invalid operators or values.',
    suggestion: 'Supported operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $contains, $startsWith, $endsWith.',
    param: 'filter',
  },

  // Dataset Specific
  DATASET_NOT_FOUND: {
    code: 'DATASET_NOT_FOUND',
    message: 'Dataset not found',
    status: 404,
    hint: 'The specified dataset name does not exist.',
    suggestion: 'Use GET /datasets to list all datasets and verify the name.',
  },
  INVALID_DATASET_NAME: {
    code: 'INVALID_DATASET_NAME',
    message: 'Invalid dataset name',
    status: 400,
    hint: 'Dataset names must be alphanumeric with underscores, hyphens, or dots (max 64 chars).',
    suggestion: 'Example valid names: "sales_2024", "user-analytics", "config.json".',
    param: 'name',
  },
  INVALID_FORMAT: {
    code: 'INVALID_FORMAT',
    message: 'Invalid dataset format',
    status: 400,
    hint: 'Only "json" and "csv" formats are supported.',
    suggestion: 'Specify format: "json" or "csv".',
    param: 'format',
  },

  // Secret Specific
  SECRET_NOT_FOUND: {
    code: 'SECRET_NOT_FOUND',
    message: 'Secret not found',
    status: 404,
    hint: 'The specified secret name does not exist.',
    suggestion: 'Use GET /secrets to list all secrets (owner only).',
  },
  INVALID_SECRET_NAME: {
    code: 'INVALID_SECRET_NAME',
    message: 'Invalid secret name',
    status: 400,
    hint: 'Secret names must be alphanumeric with underscores or hyphens (max 64 chars).',
    suggestion: 'Example valid names: "openai_api", "stripe-key", "github_token".',
    param: 'name',
  },
  SECRET_EXISTS: {
    code: 'SECRET_EXISTS',
    message: 'Secret already exists',
    status: 409,
    hint: 'A secret with this name already exists.',
    suggestion: 'Use PUT /secrets/{name} to update the existing secret, or choose a different name.',
  },
  HOST_NOT_ALLOWED: {
    code: 'HOST_NOT_ALLOWED',
    message: 'Target host not allowed',
    status: 403,
    hint: 'The target URL host is not in the secret\'s allowedHosts list.',
    suggestion: 'Update the secret to include this host in allowedHosts, or use a different secret.',
  },
  PATH_NOT_ALLOWED: {
    code: 'PATH_NOT_ALLOWED',
    message: 'Path not allowed',
    status: 403,
    hint: 'The requested path is not permitted for this secret.',
    suggestion: 'Update the secret\'s allowedPaths to include this path pattern.',
  },
  BLOCKED_DESTINATION: {
    code: 'BLOCKED_DESTINATION',
    message: 'Destination is blocked',
    status: 403,
    hint: 'This destination is on the blocklist for security reasons.',
    suggestion: 'Local/internal addresses and certain domains cannot be proxied.',
  },
  PROXY_ERROR: {
    code: 'PROXY_ERROR',
    message: 'Proxy request failed',
    status: 502,
    hint: 'The request to the target API failed.',
    suggestion: 'Check the target API is available and the credentials are valid.',
  },
  SECRET_RATE_LIMITED: {
    code: 'SECRET_RATE_LIMITED',
    message: 'Secret rate limit exceeded',
    status: 429,
    hint: 'Too many requests using this secret.',
    suggestion: 'Wait before retrying, or increase the rateLimit setting for this secret.',
  },

  // Connection Specific
  CONNECTION_NOT_FOUND: {
    code: 'CONNECTION_NOT_FOUND',
    message: 'Connection not found',
    status: 404,
    hint: 'The specified connection does not exist.',
    suggestion: 'Use GET /connections to list available connections.',
  },
  CONNECTION_ERROR: {
    code: 'CONNECTION_ERROR',
    message: 'Connection failed',
    status: 502,
    hint: 'Could not establish connection to the external service.',
    suggestion: 'Verify credentials and network connectivity.',
  },
} as const;

export interface ShareOutOptions {
  artifactId: string;
  baseUrl?: string;
  sessionToken?: string;
}
