---
title: Scheduling jobs
description: Run tasks on a cron or in response to artifact events.
---

A job runs a task attached to an artifact — on a schedule, or when something
happens. Email a weekly report, post a snapshot to Slack, refresh a dataset.

## Two triggers

| Trigger | Fires |
| --- | --- |
| `cron` | On a time schedule (`schedule` field) |
| `event` | On `artifact.updated`, `artifact.viewed`, `comment.added`, or `email.received` |

## Actions

| Action | Does |
| --- | --- |
| `email` | Send to recipients (inline HTML or a template) |
| `slack` | Post a message, snapshot, or PDF to a channel or DM |
| `discord` | Post to a Discord webhook |
| `telegram` | Message, snapshot, or PDF to a linked Telegram chat |
| `webhook` | HTTP request to your URL |
| `http_get` | Simple GET |
| `materialize` | Re-run a connection query and store the result |
| `email_sheet_sync` | On `email.received`: an Excel/CSV emailed to the page's address by an allowed, verified sender replaces one of its datasets |
| `query_snapshot` | Run fixed warehouse/REST queries on a schedule and write each result to json/table/dataset |
| `sheets_append` | Run one connection query and append rows to a Google Sheet (growing daily history) |

## Create a job

```bash
curl -X POST https://shareout.site/v1/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "artifact_id": "art_abc123",
    "title": "Weekly revenue email",
    "description": "Emails the team the latest revenue summary every Monday 9am UTC.",
    "action": "email",
    "trigger_type": "cron",
    "schedule": "0 9 * * 1",
    "config": {
      "recipients": ["team@company.com"],
      "subject": "Weekly report",
      "includeArtifactLink": true
    }
  }'
```

Always set `title` and `description` when creating a schedule — they appear in
**My schedules** and the workspace **Admin → Schedules** tab. `PATCH /v1/jobs/{id}`
accepts `title` / `description` too (send `null` to clear).

### Cron format

```
┌─ minute (0-59)
│ ┌─ hour (0-23)
│ │ ┌─ day of month (1-31)
│ │ │ ┌─ month (1-12)
│ │ │ │ ┌─ day of week (0-6, Sun=0)
* * * * *
```

`0 9 * * 1` → Mondays 9am · `*/15 * * * *` → every 15 min · `0 9-17 * * 1-5` →
hourly, business hours.

### `query_snapshot` — deterministic data refresh

Runs a configured list of queries against a workspace connection — REST **or**
inline warehouse connectors (Snowflake, BigQuery). Scheduled `query_snapshot`
jobs refresh unattended; no external pre-fetch step is required for generic
warehouse connections.

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
        "query": "SELECT region, SUM(revenue) AS revenue FROM analytics.daily GROUP BY 1",
        "target": { "type": "json", "name": "snapshot", "path": "byRegion" }
      },
      {
        "query": "SELECT * FROM analytics.orders WHERE date = CURRENT_DATE()",
        "target": { "type": "table", "name": "orders_today" },
        "mode": "replace"
      }
    ]
  }
}
```

Each entry in `queries[]` needs `query` (SQL or REST path) and `target` with
`type` (`json`, `table`, or `dataset`) and `name`. For json targets, optional
`path` merges the result at that field inside the key's object.

### `sheets_append` — warehouse → Google Sheet

Run one connection query and **append the result rows to a connected Google
Sheet** — a new dated row-set on every run, so any artifact can keep a growing
daily history in a spreadsheet.

```json
{
  "artifact_id": "art_abc123",
  "title": "Daily revenue to sheet",
  "description": "Appends yesterday's warehouse rows to the shared Google Sheet.",
  "action": "sheets_append",
  "trigger_type": "cron",
  "schedule": "0 12 * * *",
  "config": {
    "connection": "bigquery",
    "params": { "projectId": "my-gcp-project" },
    "query": "SELECT FORMAT_DATE('%Y-%m-%d', date) AS date, site, revenue FROM `my-gcp-project.analytics.daily` WHERE date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)",
    "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/1AbCdEf.../edit",
    "range": "Daily",
    "columns": ["date", "site", "revenue"]
  }
}
```

**Prerequisites:**

- The artifact **owner must have Google Sheets connected** — missing token → job
  fails with *"Google Sheets not connected"*.
- The owner needs **edit access** to the target spreadsheet; the tab in `range`
  must already exist.
- Rows append **without a header** — set up the header row once. Use `columns` to
  fix cell order.


### `email.received` event

Pair with any action to react when mail arrives at the artifact's
[inbound inbox](/everyone/inbox/):

```json
{
  "artifact_id": "art_inbox",
  "action": "slack",
  "trigger_type": "event",
  "event_type": "email.received",
  "config": {
    "connection": "team_slack",
    "channelId": "C0123456789",
    "customMessage": "New mail at {{inbox.from}}: {{inbox.subject}}"
  }
}
```

### `email_sheet_sync` — update a page's data by email

Someone emails (or auto-forwards) an Excel or CSV file to the page's own address and one of its
datasets is replaced by the file's first tab. Allowed, verified senders only.

```bash
# 1. who may send it (turns the address on) → { address, senders }
curl -X PUT https://shareout.site/v1/artifacts/art_abc123/email-sync/senders \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "senders": ["ana@acme.com"] }'
# 2. which dataset the page reads → suggestedDataset (null = it reads several: ask)
curl https://shareout.site/v1/artifacts/art_abc123/email-sync -H "Authorization: Bearer $TOKEN"
# 3. the job → 201 { job, address, senders, warning? }
curl -X POST https://shareout.site/v1/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "artifact_id": "art_abc123", "action": "email_sheet_sync", "trigger_type": "event",
        "event_type": "email.received", "title": "Update by email", "config": { "dataset": "ventas" } }'
```

- A `warning` in the `201` means the page does not read that dataset — the page would stay empty.
- One per page and dataset: a second is `409 DUPLICATE_JOB` with the existing `job_id`.
- `POST /v1/jobs/{id}/run` answers `409 NOT_RUNNABLE` with the address and changes nothing — it runs when mail arrives.
- `GET /v1/artifacts/{id}/email-sync` → `state` (`off` · `inbox_off` · `waiting_first_email` · `ok` · `failed`), a one-line `message`, `lastRejected` (the last email bounced and why) and `recentRejected` (up to 5, newest first; `canAllow: true` = a report an allowed mailbox auto-forwarded, whose verified sender can be added with one `PUT …/senders`).
- Gmail auto-forwarding: Gmail emails the page's address a confirmation first. A genuine one (DKIM and DMARC pass for google.com per Cloudflare, Google's forwarding sender, its link on Google's own host) is not bounced and never becomes data: it shows in `forwarding` (`requester`, `confirmUrl`, `code` on older ones, `expiresAt`) for the page's editors to open. `POST /v1/artifacts/{id}/email-sync/forwarding/{confirmationId}` `{ "action": "opened" | "dismiss" }`. Outlook / Microsoft 365 has no confirmation step.
- Deleting the job turns the address off and keeps the data and the sender list (`senders_kept`).
- Limits: 8 MB and 100,000 rows per file, 25 MB per email, 200 emails a day per page.

## Retries

Add `retry_config` for flaky downstreams:

```json
{ "maxAttempts": 3, "backoffType": "exponential", "initialDelay": 60 }
```

`fixed` · `linear` (`delay × (attempt+1)`) · `exponential` (`delay × 2^attempt`).

## Run, pause, inspect

| Action | Endpoint |
| --- | --- |
| Run now | `POST /v1/jobs/{id}/run` (not `email_sheet_sync`: it runs when mail arrives) |
| Pause | `PATCH /v1/jobs/{id}` → `{ "enabled": false }` |
| Recent logs | `GET /v1/jobs/{id}/logs` |

Workspace admins can also use the **Run Inspector** — a unified view across
scheduled jobs, crew automations, and metric-alert firings:

```http
GET /v1/workspaces/{id}/runs?surface=job&status=failed
GET /v1/workspaces/{id}/runs/{surface}/{runId}
```

Each run returns a normalized `RunDetail` with status, trigger, step ledger
(fetch / transform / deliver phases), delivery outcome, and cost/tokens where
applicable. See [Workspace admin → Run Inspector](/teams/admin/#run-inspector).

See the full schema in the [API reference](/api/operations/createjob/).

Pair `query_snapshot` with a [Crew](/guides/crew/) on a later cron to narrate and
deliver — the **refresh → narrate → deliver** pattern.
