# REST API: Jobs

Scheduled and event-driven tasks for email, webhooks, Slack, Discord, and HTTP triggers.

## Endpoints

```http
POST   /v1/jobs              # Create job
GET    /v1/jobs              # List your jobs (add ?artifact_id=… for one artifact)
GET    /v1/jobs/{id}         # Get job
PATCH  /v1/jobs/{id}         # Update job (enable/pause, schedule, config, title, description)
DELETE /v1/jobs/{id}         # Delete job
POST   /v1/jobs/{id}/run     # Manual trigger
GET    /v1/jobs/{id}/logs    # Recent execution logs (status, error, duration)
```

`GET /v1/jobs?artifact_id=…` is owner-aware: the artifact's owner/editor sees **every**
schedule on it (including viewer DM subscriptions); anyone else sees only their own.
A job's creator **or** the artifact owner may pause/delete/run it.

## Action Types

| Action | Description | Config Interface |
|--------|-------------|------------------|
| `email` | Send email to recipients | `EmailConfig` |
| `webhook` | HTTP request to URL | `WebhookConfig` |
| `slack` | Post to a Slack channel or DM a user (message, snapshot, or PDF) | `SlackConfig` |
| `discord` | Post to Discord webhook | `DiscordConfig` |
| `telegram` | Message / snapshot / PDF to a linked Telegram chat | `TelegramConfig` |
| `http_get` | Simple GET request | `HttpGetConfig` |
| `materialize` | Re-run a connection query and store the result as a dataset/table/json key (extract refresh) | `MaterializeConfig` |
| `query_snapshot` | Deterministic multi-query refresh: run fixed SQL/paths against a workspace connection → write each result to json/dataset/table | `QuerySnapshotConfig` |
| `sheets_append` | Run one connection query → append the result rows to a connected Google Sheet (a new dated row-set each run) | `SheetsAppendConfig` |

## Trigger Types

| Type | Description |
|------|-------------|
| `cron` | Time-based schedule (default) |
| `event` | Triggered by artifact events |

**Event Types:**
- `artifact.updated` - When artifact is published or updated
- `artifact.viewed` - When artifact is viewed (throttled: 1/hour/visitor)
- `comment.added` - When a comment is added
- `email.received` - When inbound mail arrives at the artifact's inbox (see [../integrations/inbound-email.md](../integrations/inbound-email.md))

## POST /v1/jobs (Create)

### Cron-Triggered Job

```json
{
  "artifact_id": "art_abc123",
  "title": "Weekly revenue email",
  "description": "Emails the team the latest revenue summary every Monday 9am UTC.",
  "action": "email",
  "trigger_type": "cron",
  "schedule": "0 9 * * 1",
  "config": {
    "recipients": ["team@company.com"],
    "subject": "Weekly report",
    "html": "<h1>Update</h1>",
    "includeArtifactLink": true
  },
  "retry_config": {
    "maxAttempts": 3,
    "backoffType": "exponential",
    "initialDelay": 60
  }
}
```

### Event-Triggered Job

```json
{
  "artifact_id": "art_abc123",
  "action": "slack",
  "trigger_type": "event",
  "event_type": "artifact.updated",
  "config": {
    "webhookUrl": "https://hooks.slack.com/services/...",
    "channel": "#updates",
    "includeArtifactLink": true
  }
}
```

### Request Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `artifact_id` | string | Yes | Associated artifact |
| `title` | string | No | Short human name shown in the schedules UI (≤200 chars). Strongly recommended — without it the UI synthesizes a generic name. |
| `description` | string | No | One-line description of what the schedule does and why (≤1000 chars). Shown under the title. |
| `action` | string | Yes | `email`, `webhook`, `slack`, `discord`, `telegram`, `http_get`, `materialize`, `query_snapshot`, `sheets_append` |
| `trigger_type` | string | No | `cron` (default) or `event` |
| `schedule` | string | Cron only | Cron expression (required for cron jobs) |
| `event_type` | string | Event only | Event to trigger on (required for event jobs) |
| `config` | object | Yes | Action-specific config |
| `retry_config` | object | No | Retry configuration |

> **Always set `title` and `description`** when creating a schedule. They appear in the user's **My schedules** view and the workspace **Admin → Schedules** tab. `PATCH /v1/jobs/{id}` accepts `title` / `description` too (send `null` to clear).

### Retry Configuration

```typescript
interface RetryConfig {
  maxAttempts: number;      // 0-10, default: 1
  backoffType: 'fixed' | 'linear' | 'exponential';  // default: 'fixed'
  initialDelay: number;     // 60-3600 seconds, default: 300
}
```

**Backoff Calculation:**
- `fixed`: delay = initialDelay
- `linear`: delay = initialDelay × (attempt + 1)
- `exponential`: delay = initialDelay × 2^attempt

## POST /v1/jobs/{id}/run (Manual Trigger)

Execute a job immediately without waiting for schedule.

**Request:** None (empty body)

**Response:**
```json
{
  "message": "Job executed successfully",
  "execution": {
    "success": true,
    "job_id": "job_xyz789",
    "execution_id": "log_abc123",
    "status": "success",
    "duration_ms": 234
  }
}
```

**Notes:**
- Does NOT update `next_run_at` (manual runs don't affect schedule)
- Creates execution log entry
- Respects rate limits for email jobs

## Config Interfaces

### EmailConfig

```typescript
interface EmailConfig {
  recipients: string[];           // Max 10
  subject?: string;               // Required if no template_id
  html?: string;                  // Required if no template_id (also the FALLBACK body, see below)
  text?: string;
  replyTo?: string;               // `from` is NOT settable — the platform sets it
  includeArtifactLink?: boolean;
  includeArtifactContent?: boolean;
  // Live-render fields — re-render the artifact server-side and use its output:
  useArtifactEmailHtml?: boolean; // Use window.__shareoutExport.emailHtml/emailSubject as the body
  attachArtifactCsv?: boolean;    // Attach window.__shareoutExport.csv
  renderPdf?: boolean;            // Attach a full-height PDF of the rendered page
  pdfFilename?: string;
  template_id?: string;           // Use email template (see /v1/templates)
  template_data?: Record<string, unknown>;  // Variables for template interpolation
}
```

**Data-driven report emails (live render):** {#live-render}

For a daily report whose numbers change every run (e.g. a dashboard fed by a `query_snapshot` job), do **not** hardcode the body in `html`. Instead set `useArtifactEmailHtml: true` and have the artifact publish a ready-to-send body. At send time the worker renders the live page **once** with an injected read-only owner session (so the page's own data reads succeed against the workspace connection), then reads:

```js
// In the artifact page, after rendering with live data:
window.__shareoutExport = {
  emailSubject: `Daily report — ${date}`,
  emailHtml,        // a self-contained, INLINE-STYLED HTML body (email clients drop <style>/<head> CSS)
  csv,              // optional; attached when attachArtifactCsv is true
  csvFilename: `report-${date}.csv`,
};
window.__shareoutReady = true;   // REQUIRED — tells the renderer data is ready to capture
```

Contract — every one of these is load-bearing (omitting any silently falls back to the plain `html`):

- **Bootstrap with `await ShareOut.create()`** (not `new ShareOut()`, and there is no `ShareOut.connect()`). If `create()` throws or is misnamed, the page never sets `__shareoutExport` and the email falls back to `config.html`.
- **Set `window.__shareoutReady = true`** once the page has rendered with data — in *every* code path (success, empty, and error). The renderer waits for this flag before capturing; without it the capture races your async data load and grabs nothing.
- **Inline every style in `emailHtml`.** Use table-based layout for KPI rows/grids (Outlook ignores fl/grid). The on-page CSS in `<style>`/`<head>` is for the dashboard view only.
- Keep `html` set to a short plain fallback (e.g. `"<p>Report attached.</p>"`) — it ships only if the render fails, so seeing it in your inbox means the contract above broke.

Pair this with a `query_snapshot` job a bit earlier in the day to refresh the json the page reads (see [QuerySnapshotConfig](#querysnapshotconfig)). Verify a real send with `POST /v1/jobs/{id}/run` and read the delivered email — a successful job status only means it sent *something*, not that the live body was captured.

**Using Templates:**

When `template_id` is provided, the template's subject and HTML are used instead of inline values. Pass `template_data` to populate `{{data.*}}` variables.

```json
{
  "artifact_id": "art_abc123",
  "action": "email",
  "schedule": "0 9 * * 1",
  "config": {
    "recipients": ["team@company.com"],
    "template_id": "tpl_xyz789",
    "template_data": {
      "summary": "Weekly sales report",
      "highlight": "Revenue up 15%"
    }
  }
}
```

See [REST API: Templates](templates.md) for template CRUD operations.

### WebhookConfig

```typescript
interface WebhookConfig {
  url: string;                    // HTTPS only
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';  // Default: POST
  headers?: Record<string, string>;
  includeArtifactData?: boolean;  // Include data_json in payload
}
```

**Webhook Payload (for POST/PUT/PATCH):**
```json
{
  "artifact_id": "art_abc123",
  "artifact_name": "My Report",
  "artifact_url": "$ORIGIN/a/my-report/",
  "triggered_at": "2024-01-08T09:00:00Z",
  "data": {...}  // Only if includeArtifactData=true
}
```

**Note:** GET and DELETE methods do not send a request body.

### SlackConfig

Slack delivery has two modes. **Bot-token** (recommended) uses a workspace Slack
connection (OAuth app) and can post to channels **or** DM a user, and can attach a
rendered snapshot or PDF of the artifact. **Legacy webhook** posts a text message
to an incoming-webhook URL.

```typescript
interface SlackConfig {
  // ── Bot-token delivery (recommended) ──────────────────────────────
  connection?: string;            // workspace Slack connection name (required for bot-token)
  targetType?: 'channel' | 'dm';  // default 'channel'
  channelId?: string;             // Slack channel id (C…/G…) — required when targetType 'channel'
  slackUserId?: string;           // Slack member id (U…) — required when targetType 'dm'
  mode?: 'message' | 'snapshot' | 'pdf' | 'both'; // default 'message'
  waitMs?: number;                // max ms to wait for data to load before capture
  customMessage?: string;         // message / image caption text

  // ── Legacy incoming-webhook delivery ──────────────────────────────
  webhookUrl?: string;            // HTTPS only (use this OR connection)
  channel?: string;               // Override default channel
  username?: string;              // Default: "ShareOut"
  iconEmoji?: string;             // Default: ":chart_with_upwards_trend:"
  includeArtifactLink?: boolean;  // Add attachment with link
}
```

**Preconditions for bot-token delivery:** the artifact's workspace must have a Slack
connection set up (see [../integrations/slack.md](../integrations/slack.md)). DM
delivery (`targetType: 'dm'`) needs the `im:write` scope — reconnect Slack if a job
fails with `missing_scope`.

**Modes:** `message` posts text + an "Open in ShareOut" button; `snapshot` uploads a
full-page PNG of the rendered artifact; `pdf` uploads a full-height PDF; `both` posts
the message then the snapshot.

```json
{
  "artifact_id": "art_abc123",
  "action": "slack",
  "schedule": "0 9 * * 1",
  "config": { "connection": "team", "channelId": "C0123456789", "mode": "snapshot" }
}
```

**Viewer self-subscription:** a non-owner with access to an artifact may schedule a
Slack **DM to themselves** (`targetType: 'dm'` with their own `slackUserId`) or an
email to their own account address — no other channels/recipients. The artifact's
owner sees and can pause/delete every schedule on their artifact (see
`GET /v1/jobs?artifact_id=…` below). Each run re-checks the creator still has access;
if access was revoked the job auto-pauses.

### TelegramConfig

Deliver to a **linked Telegram chat**. Requires the recipient (usually the job
creator) to have connected Telegram in ShareOut Settings.

```typescript
interface TelegramConfig {
  /** Chat to deliver to. Omit to use the creator's own linked Telegram chat. */
  chatId?: string;
  /** message (default), snapshot image, PDF, or message + snapshot. */
  mode?: 'message' | 'snapshot' | 'pdf' | 'both';
  customMessage?: string;
  includeArtifactLink?: boolean;
  /** Max ms to wait for artifact data to load before capturing image/PDF. */
  waitMs?: number;
}
```

**Preconditions:** target user has a linked chat
(Settings → Connect Telegram). Validation error if no linked chat: *"No linked
Telegram chat — open ShareOut → Settings → Connect Telegram first"*.

**Modes:** same semantics as Slack — `message` posts text (+ optional artifact link);
`snapshot` uploads a full-page PNG; `pdf` uploads a full-height PDF; `both` posts
the message then the snapshot.

```json
{
  "artifact_id": "art_abc123",
  "action": "telegram",
  "schedule": "0 9 * * 1",
  "config": { "mode": "snapshot", "customMessage": "Weekly dashboard" }
}
```

**Viewer self-subscription:** a non-owner may schedule Telegram delivery **only to
their own linked chat** (omit `chatId`). They cannot target another user's chat id.

### DiscordConfig

```typescript
interface DiscordConfig {
  webhookUrl: string;             // HTTPS only
  username?: string;              // Default: "ShareOut"
  avatarUrl?: string;
  embedTitle?: string;            // Default: artifact name
  embedColor?: number;            // Decimal color (default: 3978236 blue)
  includeArtifactLink?: boolean;  // Add embed with link
  customMessage?: string;
}
```

### HttpGetConfig

```typescript
interface HttpGetConfig {
  url: string;                    // HTTPS only
  headers?: Record<string, string>;
}
```

### MaterializeConfig

Re-runs a connection query on a schedule and stores the result durably (extract
refresh). Reads of the materialized data stay direct-from-R2. See
[../sdk/connections.md](../sdk/connections.md).

```typescript
interface MaterializeConfig {
  connection: string;                          // connection name to query
  query: string | object;                      // server-side query (rest_api) or SQL (warehouse)
  target: { type: 'dataset' | 'table' | 'json'; name: string; path?: string };
  mode?: 'replace' | 'append';                 // default 'replace'
  format?: 'json' | 'csv';                     // dataset only, default 'json'
}
```

`target.type: "json"` writes rows into the artifact's JSON store under `name`, optionally merging at `path` inside that key's object — useful for dashboards that read a snapshot from `sdk.json`.

### QuerySnapshotConfig

Deterministic, owner-authored refresh: run a **fixed list** of queries against one workspace connection (REST or a warehouse like BigQuery, on the **artifact owner's** credentials) and write each result into the artifact store. SQL lives in job config — not in an agent prompt — so dashboards get a reliable daily snapshot without LLM involvement.

Typical pattern: a `query_snapshot` cron job refreshes json fields the page reads; a separate crew trigger (or `notify_send`) reads that json, writes a narrative, and delivers to Slack/Telegram.

```typescript
interface QuerySnapshotConfig {
  connection: string;                          // workspace connection name (e.g. platform BigQuery)
  params?: Record<string, unknown>;          // shared params for every query (e.g. { projectId })
  queries: Array<{
    query: string;                             // SQL (warehouse) or path (REST)
    target: { type: 'dataset' | 'table' | 'json'; name: string; path?: string };
    mode?: 'replace' | 'append';               // default 'replace'
  }>;
}
```

**Example cron job (BigQuery → json snapshot):**

```json
{
  "artifact_id": "art_dashboard",
  "action": "query_snapshot",
  "trigger_type": "cron",
  "schedule": "0 6 * * *",
  "config": {
    "connection": "team_bigquery",
    "params": { "projectId": "my-gcp-project" },
    "queries": [
      {
        "query": "SELECT date, revenue FROM `my-gcp-project.analytics.daily` WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)",
        "target": { "type": "json", "name": "snapshot", "path": "daily_revenue" }
      }
    ]
  }
}
```

Requires **owner/editor**. Uses `queryConnectionAny` under the hood — per-user warehouse connectors work when the artifact owner has linked credentials. See [../agents/crew.md](../agents/crew.md) for the interactive crew equivalent (`materialize_query`).

### SheetsAppendConfig

Run one connection query and **append the result rows to a connected Google Sheet** — a new dated row-set on every run, so any artifact can keep a growing daily history in a spreadsheet the customer already shares (no dashboard required).

```typescript
interface SheetsAppendConfig {
  spreadsheetId?: string;   // target sheet — bare id …
  spreadsheetUrl?: string;  // … or the full https://docs.google.com/spreadsheets/d/<id>/… URL
  range?: string;           // tab (optionally an A1 range) to append into. Default 'Sheet1'
  connection: string;       // workspace connection to query (e.g. a BigQuery platform connection)
  params?: Record<string, unknown>;  // e.g. { projectId } for BigQuery, { timeoutMs }
  query: string;            // SQL (warehouse) or path (REST) producing the rows
  columns?: string[];       // ordered output columns → cells. Default: keys of the first row
  skipIfEmpty?: boolean;    // no-op (success) when the query returns 0 rows. Default true
}
```

```json
{
  "artifact_id": "art_abc123",
  "action": "sheets_append",
  "trigger_type": "cron",
  "schedule": "0 12 * * *",
  "config": {
    "connection": "bigquery",
    "params": { "projectId": "my-gcp-project" },
    "query": "SELECT FORMAT_DATE('%Y-%m-%d', date) AS date, site, revenue, impressions, cpm FROM `my-gcp-project.analytics.daily` WHERE date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)",
    "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/1AbCdEf.../edit",
    "range": "Daily",
    "columns": ["date", "site", "revenue", "impressions", "cpm"]
  }
}
```

**Prerequisites & behavior:**
- The artifact **owner must have Google Sheets connected** (`POST /v1/data/{id}/sheets/authorize`) — the append uses the owner's token. Missing → the job fails with *"Google Sheets not connected"*.
- The owner needs **edit access** to the target spreadsheet, and the tab in `range` must already exist. Append uses `valueInputOption=USER_ENTERED`, `insertDataOption=INSERT_ROWS`.
- Rows are appended **without a header** — set up the header row in the sheet once. `columns` fixes the cell order (recommended); otherwise the first row's key order is used, which can drift.
- Pair with a slightly-earlier `query_snapshot`/data refresh if the same numbers also feed a dashboard, or just run the query directly here — it's independent.
- `null`/`undefined` cells become empty strings; objects/arrays are JSON-encoded.


### Weekly Report Email

```json
{
  "artifact_id": "art_abc123",
  "action": "email",
  "schedule": "0 9 * * 1",
  "config": {
    "recipients": ["team@company.com"],
    "subject": "Weekly Dashboard Update",
    "includeArtifactLink": true,
    "includeArtifactContent": true
  },
  "retry_config": {
    "maxAttempts": 2,
    "backoffType": "fixed",
    "initialDelay": 300
  }
}
```

### Slack Notification on Update

```json
{
  "artifact_id": "art_abc123",
  "action": "slack",
  "trigger_type": "event",
  "event_type": "artifact.updated",
  "config": {
    "webhookUrl": "https://hooks.slack.com/services/T.../B.../xxx",
    "channel": "#dashboard-updates",
    "customMessage": "Dashboard has been updated!",
    "includeArtifactLink": true
  }
}
```

### Discord Alert on Comments

```json
{
  "artifact_id": "art_abc123",
  "action": "discord",
  "trigger_type": "event",
  "event_type": "comment.added",
  "config": {
    "webhookUrl": "https://discord.com/api/webhooks/.../...",
    "embedTitle": "New Comment",
    "embedColor": 5814783,
    "includeArtifactLink": true
  }
}
```

### Webhook with Exponential Backoff

```json
{
  "artifact_id": "art_abc123",
  "action": "webhook",
  "schedule": "0 */6 * * *",
  "config": {
    "url": "https://api.example.com/webhook",
    "method": "POST",
    "headers": { "X-API-Key": "secret" },
    "includeArtifactData": true
  },
  "retry_config": {
    "maxAttempts": 5,
    "backoffType": "exponential",
    "initialDelay": 60
  }
}
```

## Related

- [SDK: Email](../sdk/email.md) - SDK email methods
- [REST API: Templates](templates.md) - Email templates CRUD
- [Overview](overview.md) - API intro
