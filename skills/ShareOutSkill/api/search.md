# Search

Ranked, typo-tolerant search across a workspace — the same engine behind the ShareOut Cmd+K palette. Finds **pages** (by name, tags, and description), plus **folders**, **shared datasets**, **connectors**, **people** (members), **schedules**, **crew**, and **alerts** when scoped to a workspace. Use it to locate a page before reading or updating it, instead of listing everything and filtering yourself.

## Endpoint

```http
GET /v1/search?q={query}&groups={csv}&limit={n}&workspace={id}
Authorization: Bearer {token}
```

Auth: any ShareOut credential works.

- `so_…` personal token → searches everything that user can see. Pass `workspace={id}` to scope to one workspace.
- `sot_…` workspace Agent token → automatically pinned to the token's workspace (the `workspace` param is ignored). Requires the `artifacts:read` scope.
- Session cookie → same as the personal token (used by the in-app palette).

### Query params

| Param | Default | Notes |
|-------|---------|-------|
| `q` | *(required)* | The search text. Typo/gap tolerant — `revnue` matches "Revenue Report". Empty `q` returns recents. |
| `groups` | all | Comma-separated subset of `artifacts,folders,datasets,connectors,people,schedules,crew,alerts`. |
| `limit` | 10 | Max results **per group** (capped at 25). |
| `workspace` | — | Workspace id to scope to (personal tokens only; Agent tokens are already scoped). |

Every group except `artifacts` is only returned when the search is scoped to a concrete workspace (an Agent token, or a personal token with `workspace={id}`).

Artifact hits are enriched: `views` (lifetime view count), `owner` (display name), `thumb` (preview-image URL), `avatar` (owner picture), and a `badge` (e.g. `Private`). People carry `avatar`; schedules / crew / alerts carry a `badge` for status (`Paused`, `Failing`, `Triggered`).

## Response

```json
{
  "query": "revenue",
  "artifacts": [
    {
      "kind": "artifact",
      "id": "art_1a2b3c",
      "title": "Q3 Revenue Report",
      "subtitle": "Monthly revenue and margin breakdown",
      "slug": "q3-revenue-report",
      "artifactType": "html",
      "views": 1240,
      "owner": "Ana Ruiz",
      "thumb": "/t/art_1a2b3c_card.webp?v=…",
      "score": 0.98
    }
  ],
  "folders":   [{ "kind": "folder",    "id": "fld_x", "title": "Finance", "subtitle": "6 pages", "score": 0.7 }],
  "datasets":  [{ "kind": "dataset",   "id": "revenue_daily", "title": "revenue_daily", "subtitle": "read", "score": 0.6 }],
  "connectors":[{ "kind": "connector", "id": "wc_9", "title": "snowflake-prod", "subtitle": "snowflake", "score": 0.55 }],
  "people":    [{ "kind": "person",    "id": "usr_3", "title": "Ana Ruiz", "subtitle": "Admin · ana@co.com", "avatar": "https://…", "score": 0.5 }],
  "schedules": [{ "kind": "schedule",  "id": "job_7", "title": "Q3 Revenue Report", "subtitle": "Email report · 0 9 * * 1", "score": 0.5 }],
  "crew":      [{ "kind": "crew",      "id": "crw_2", "title": "Nav Behavior", "subtitle": "Active crew", "score": 0.4 }],
  "alerts":    [{ "kind": "alert",     "id": "alr_1", "title": "MRR drop", "subtitle": "Alert · slack", "badge": "Triggered", "score": 0.4 }]
}
```

Each hit carries a `score` (higher = better; results are pre-sorted descending). For a page, open it with its `id` via [artifacts.md](artifacts.md) (`GET /v1/artifacts/{id}`) or link to `/a/{slug}/`.

### Ranking

Matches are tiered: exact title > prefix > word-boundary > substring > every-token > in-order subsequence (the typo-tolerant tier), with a small recency nudge for recently-updated pages. Titles outrank tag and description hits. Search ranks over a candidate pool of the workspace's pages; on very large workspaces older pages beyond the pool are matched by exact substring but not fuzzily.

## Example

```bash
curl "$ORIGIN/v1/search?q=cpm&groups=artifacts,datasets&limit=5" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN"
```

## Ask your workspace (answer mode)

When the query looks like a **question** (ends with `?` or starts with *what / how / why / when / where / who / which / show / list / tell*), the **⌘K** palette switches to **answer mode** instead of listing jump targets. It calls:

```http
POST /v1/ask
Authorization: Bearer {token}
Content-Type: application/json

{ "question": "Which dashboards track MRR?", "workspace": "ws_abc" }
```

| Field | Required | Description |
|-------|----------|-------------|
| `question` | yes | Natural-language question over pages you can access. |
| `workspace` | no | Scope to one workspace (required for workspace-only pages). Agent tokens are already scoped. |

Response:

```json
{
  "answer": "Two pages track MRR: [1] tracks it in the main KPI card …",
  "citations": [
    { "artifact_id": "art_1", "title": "Revenue dashboard", "url": "/a/revenue-dashboard/" }
  ]
}
```

The engine runs **one focused agent turn** over a small candidate set from the same ranked search pool (`quickSearch`, up to 8 pages). Citations only ever point at artifacts the caller can already open. Runs on the workspace's own provider key like other assistant turns.

**When to use which:**
- **`GET /v1/search`** — jump to a known name, browse recents, or list connectors/people/schedules.
- **`POST /v1/ask`** — synthesize an answer across multiple pages with inline citations.

## Agent chat tool

Inside the ShareOut agent chat this same search is exposed as the **`search_workspace`** tool (query, optional `groups`, optional `limit`) — prefer it over `search_artifacts` for anything but an exact page name. For open-ended questions across pages, the palette uses **`POST /v1/ask`** instead.
