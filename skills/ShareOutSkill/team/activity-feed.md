# Home Activity Feed

The redesigned workspace **Home** surfaces two complementary activity views in the right-rail **Inspector**:

| Surface | Tier | What it shows |
| --- | --- | --- |
| **Needs You** | `actionable` | Individual rows that need action — one event per row |
| **Pulse** | `ambient` | Aggregated counts over a time window — never a raw firehose |

Load [SKILL.md](SKILL.md) first.

## Needs You (actionable kinds)

Each row is a single event the viewer should act on:

| Kind | Default audience | Examples |
| --- | --- | --- |
| `comment` | members | Unresolved comments on artifacts you can see (not your own) |
| `reply` | members | Replies in threads you participate in |
| `mention` | self | Comments whose `mentions` name one of your emails — matched on the stored array, so it agrees with the email/Telegram notifier |
| `share` | self | Artifacts shared directly with you |
| `access` | admins | Access requests to private/workspace pages |
| `alert` | members | Metric-alert triggers |
| `metric_watch` | members | One-click table watches that moved sharply (≥ threshold) |
| `stale_data` | members | Google Sheets connections that stopped syncing (7+ days) |
| `unused_artifacts` | admins (workspace) / self (personal) | Monthly suggestion to archive never-viewed published pages |
| `test` | members | Failed artifact safety-net test runs |
| `file` | admins | Spreadsheets and files members forward to the workspace file inbox |

Failed **job or crew runs** (`run` kind) are promoted into Needs You at query time even though successful runs appear only in Pulse.

A comment that names you is classified as `mention`, not `comment`/`reply`, so turning
the general comment stream down does not silence being named.

## Pulse (ambient kinds)

Aggregated counts for a selected window (`today`, `7d`, `30d`):

| Kind | Default audience | Examples |
| --- | --- | --- |
| `run` | members | Scheduled job and crew executions |
| `publish` | members | New versions published |
| `create` | members | Artifacts created |
| `favorite` | self | Who starred an artifact |
| `view` | self | Artifact page views |
| `connection` | admins | Data sources and connectors wired up |
| `skill` | members | Skills attached to artifacts |
| `member` | admins | People joining the workspace |
| `agent` | self | Workspace AI assistant activity |

## Activity visibility (admin)

Workspace **owners and admins** control who sees each kind. Defaults are privacy-first (e.g. views and favorites default to `self` only).

| Audience | Who sees the event |
| --- | --- |
| `self` | Only the actor (or recipient for shares) |
| `members` | All workspace members |
| `admins` | Workspace owners and admins only |
| `off` | Kind suppressed in this workspace |

Configure in Home **Activity → settings** or via API.

## REST API

All routes require a signed-in session or bearer token and workspace membership (when `workspace` is set).

| Method | Endpoint | Role | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/home/activity-feed?workspace=&window=&limit=` | member+ | Needs You + Pulse payload (`needs`, `seen`, `pulse`, `actionItems`, `requestedOpen`) |
| `GET` | `/v1/home/event-visibility?workspace=` | member+ | List kinds with labels, tiers, and effective audiences; `canManage` for admins |
| `PUT` | `/v1/home/event-visibility?workspace=` | admin+ | `{ "kind", "audience" }` — set one kind's audience |

### Activity feed

```http
GET /v1/home/activity-feed?workspace=ws_abc&window=7d&limit=50
Authorization: Bearer {token}
```

`window` — `today`, `7d`, or `30d` (default `7d`).

Response includes:

| Field | What it is |
| --- | --- |
| `needs` | Actionable rows still waiting on you (excludes dismissed/opened items) |
| `seen` | Dismissed or opened Needs You events still within the selected window/limit — powers the notifications panel **Seen** tab |
| `pulse` | Aggregated ambient counts per kind |
| `actionItems` | Comment action items assigned to you |
| `requestedOpen` | Count of your outstanding delegations |

Opening a notification card or calling `POST /v1/home/dismiss-event` moves an event from `needs` into `seen` for the signed-in user.

### Set visibility

```http
PUT /v1/home/event-visibility?workspace=ws_abc
Authorization: Bearer {token}
Content-Type: application/json

{ "kind": "view", "audience": "members" }
```

`workspace` query param is required for writes. Returns `{ "ok": true }`.

## Related

- [../core/workspace-home.md](../core/workspace-home.md) — Home layout, Inspector, Edit-Lite
- [../sdk/comments.md](../sdk/comments.md) — comment threads surface in Needs You
- [api.md](api.md#home-activity) — endpoint table
- [SKILL.md](SKILL.md#workspace-admin-surfaces) — admin surfaces
