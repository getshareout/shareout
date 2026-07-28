# Metric Alerts - Developer Guide

## Overview

Follow Metric Alerts turns a dashboard number into an operational signal: watch a
value on an artifact, fire when it crosses a threshold, deliver through the shared
destination layer (Slack/email/Discord/webhook). It is a **workspace feature for
teams** and reuses the scheduling runner, the delivery registry, and the workspace
role model rather than rebuilding them.

Two object types:

- **Metric definition** — a followable number an owner exposes on an artifact.
- **Alert rule** — a subscription: condition + cron schedule + destination.

The evaluator reads the artifact's **stored** data (the per-artifact MiniDb,
ADR 28), never the rendered page, so the displayed KPI and the alert agree only if
the value is persisted to `sdk.json` or a table.

```
sdk.json "metrics" = { revenue: 92420 }      artifact_rows / artifact_json (MiniDb)
            │                                          ▲
   PUT /v1/metric-alerts/definitions  ──►  artifact_metric_definitions (source_json)
            │                                          │
   POST /v1/metric-alerts  ──►  metric_alert_rules (condition, schedule, destination)
            │
   scheduled() every minute → handleScheduledEvent → runDueMetricAlerts(env)
            ├─ rules where enabled=1 AND next_run_at<=now (LIMIT 50)
            ├─ resolveAlertRole(creator) → null ⇒ disable (fail closed)
            ├─ evaluateMetric() → number from json_path / table_count / table_aggregate
            ├─ evaluateCondition() → threshold crossed?
            ├─ matched && cooldown elapsed ⇒ getDestination(kind).deliver()
            ├─ INSERT metric_alert_runs  (value, matched, delivered)
            └─ advance next_run_at by the cron
```

## Directory Structure

```
src/metric-alerts/
├── types.ts          # MetricSource, AlertCondition, MetricDefinition, MetricAlertRule
├── sources.ts        # evaluateMetric() + evaluateCondition()
├── access.ts         # resolveAlertRole() — workspace-aware manager/viewer/null
├── definitions.ts    # metric definition CRUD + validateSource + hasMetricDefinitions
└── rules.ts          # rule CRUD, evaluateAndDeliver(), runDueMetricAlerts()

src/router/api/metric-alerts.ts   # /v1/metric-alerts[/definitions] routes
migrations/0057_metric_alerts.sql # 3 tables
```

Runner wiring: `runDueMetricAlerts(env)` is called from `handleScheduledEvent` in
`src/scheduling/handler.ts`, right after `runScheduledJobs`.

Toolbar: `src/serve/sandbox-viewer/toolbar/` renders a **Follow metric** button +
modal for logged-in viewers when `hasMetricDefinitions(env, artifactId)` is true.

## Data model (migration 0057)

| Table | Purpose |
|-------|---------|
| `artifact_metric_definitions` | Followable metrics. `UNIQUE(artifact_id, metric_id)`, `source_json`, `workspace_id`. |
| `metric_alert_rules` | Subscriptions. Carries BI state: `last_value`, `last_triggered_at`, `last_triggered_value`, `last_status`, `next_run_at`, `cooldown_seconds`. |
| `metric_alert_runs` | Per-evaluation history (`value`, `matched`, `delivered`, `error`, `message`). |

Timestamps are unix seconds (`unixepoch()`), matching `scheduled_jobs` so the
runner logic is uniform.

## Metric sources (`sources.ts`)

| `type` | Evaluation |
|--------|-----------|
| `json_path` | `SELECT value FROM artifact_json WHERE key=?`, `JSON.parse`, walk a minimal JSONPath (`$.a.b[0]`). |
| `table_count` | `COUNT(*)` over `artifact_rows` with `filterToSql(where)`. |
| `table_aggregate` | `SUM/AVG/MIN/MAX(CAST(json_extract(data,'$.field') AS REAL))`. |

`where` reuses the table query operators and `{ "$daysAgo": N }` resolution.
Evaluation runs at **owner scope** (no row filter) — alerts watch the global
snapshot, not per-viewer rows.

`evaluateCondition(op, threshold, value, lastValue)` handles absolute ops
(`gt/gte/lt/lte/eq`) and percent-change ops (`change_pct_gt/lt`) which need a
prior `last_value` (first run only baselines, never fires).

## Permissions (`access.ts`)

`resolveAlertRole(env, artifact, userId)` → `'manager' | 'viewer' | null`:

- **manager** = artifact owner/editor (`getUserRole`) OR workspace owner/admin
  (`getWorkspaceRole`) → define metrics, any destination, manage all rules.
- **viewer** = viewer-collaborator or workspace member → self-delivery only
  (reuses `checkViewerSelfDelivery` exported from `src/scheduling/jobs.ts`).
- **null** → no access; on a rule's next evaluation this disables it (fail closed).

## Scheduling & delivery (reuse)

- Cron parse / next-run: `parseCronSchedule` / `getNextRunTime` from `scheduling/jobs.ts`.
- Delivery: `getDestination(kind).validate/deliver` with a `DeliveryContext`
  (`createdBy = rule.owner_id`). The alert text is injected into the destination
  config (`customMessage` for slack/discord, `subject`/`body` for email) without
  clobbering author-provided content.
- **Cooldown vs schedule:** the cron controls how often we *check* (`next_run_at`
  advances every run); `cooldown_seconds` (default 1 day, clamped 60s–30d) gates
  *re-delivery* once matched, via `last_triggered_at`.

## Quotas

| Limit | Value | Enforced in |
|-------|-------|-------------|
| Metrics per artifact | 10 | `definitions.upsertDefinition` |
| Active rules per artifact | 20 | `rules.createRule` |
| Personal rules per user (viewers) | 10 | `rules.createRule` |
| Rules per scheduled tick | 50 | `runDueMetricAlerts` query LIMIT |

## API

`/v1/metric-alerts` (rules) and `/v1/metric-alerts/definitions` — account API-token
auth (same as `/v1/jobs`), not the artifact-scoped data tokens. Full reference:
`skills/ShareOutSkill/api/metric-alerts.md`.

## Ops notes

- **Migration 0057 is not auto-applied by CI.** Run `npm run db:migrate:prod`
  (the deploy job's "unapplied D1 migrations" gate fails the deploy otherwise).
- Tables are additive + `CREATE TABLE IF NOT EXISTS` (idempotent / safe to re-run).
- The toolbar existence check (`hasMetricDefinitions`) is gated to logged-in views
  so the anonymous public hot path adds no D1 read.

## Not yet built (deliberate)

- Publish-time `<script type="shareout/metrics">` auto-parsing — definitions are
  API-only for now.
- Crew-on-trigger investigations — phase 2; schema leaves room via an `on_trigger`
  concept (`dispatchCrewRun` already exists in `src/crew/`).
