---
title: Access policy (row-level)
description: Server-enforced per-viewer row filtering — how ShareOut resolves a verified email to the exact slice of data that viewer may see.
---

Row-level access policy lets you share **one** artifact externally and have each viewer see **only their own slice** of the data — each customer their `company_id`, each prospect their `pitch`, each region lead their `region`. Filtering is enforced server-side inside the Cloudflare Worker, after the viewer is identified and before any row is returned. The viewer cannot bypass or widen it.

For the non-technical overview of visibility and sharing, see [Who sees what](/everyone/who-sees-what/).

## Why server-side enforcement matters

A ShareOut artifact runs in the viewer's browser and is fully inspectable — they can read the JS, open devtools, and call `/v1/data/…` endpoints directly with any filter they choose. A filter written in your page code (`sdk.table('sales').find({ company_id: 1 })`) is cosmetic. The access policy runs inside the Worker; the viewer cannot influence it.

## When to use

| Goal | Use policy? |
|------|-------------|
| One dashboard shared with multiple external customers, each seeing only their own rows | Yes |
| A pitch deck where each prospect sees only their own numbers | Yes |
| Internal tool where every collaborator should see everything | No — use [collaborators](/everyone/collaborators/) |
| Hide which other tenants exist from unmatched viewers | Yes — set `default: "deny"` |
| Per-viewer secret content baked into the HTML | Not possible — secret content must come through the data layer |

## Request flow

```
Author                              Viewer
──────                              ──────
1. Publish artifact                 3. Opens private artifact URL
   visibility: private                 → signs in with Google or email OTP
   auth_method: google                 → Worker has VERIFIED email
   share_with: [emails]
   access_policy: { … }            4. Page calls sdk.table('sales').find()
                                       → POST /v1/data/{id}/tables/sales/query
2. Policy stored server-side        5. Worker resolves email/domain → scope
   (never read from HTML)              runs: WHERE <client filter>
                                              AND company_id IN (…)
                                    6. Only in-scope rows returned.
```

Owners and editor collaborators bypass the policy and see all data (for authoring and QA). The policy applies only to viewer-role collaborators and external sign-ins.

Use [`sdk.me()`](/sdk/overview/#viewer-identity) in your artifact to branch the UI by
viewer role (e.g. show an admin panel for `canEdit`, a read-only client view otherwise).
Server enforcement is unchanged — never rely on client-side checks alone.

## Policy schema

Attach an `access_policy` object at publish time. It is stored server-side and can be updated without re-publishing the HTML.

```json
{
  "version": 1,
  "field": "company_id",
  "default": "deny",
  "rules": [
    { "match": { "email": "buyer@acme.com" }, "values": [1] },
    { "match": { "domain": "acme.com" },       "values": [1, 2] },
    { "match": { "domain": "globex.com" },     "values": [3] }
  ]
}
```

| Key | Type | Description |
|-----|------|-------------|
| `version` | `1` | Schema version. Must be `1`. |
| `field` | string | The row field to filter on. Must match the JSON key stored in each row (e.g. `company_id`, `tenant`, `region`). |
| `default` | `"deny"` \| `"allow"` | Outcome for a viewer matching no rule. `"deny"` → zero rows (recommended). `"allow"` → unfiltered. |
| `rules` | array | Ordered list of match→values rules. A viewer accumulates the **union** of `values` from all matching rules. |
| `rules[].match.email` | string | Exact email match, case-insensitive. |
| `rules[].match.domain` | string | Email-domain match (`buyer@acme.com` → domain `acme.com`). Each rule must have at least one of `email` or `domain`. |
| `rules[].values` | array of string\|number | Allowed values of `field` for a matching viewer. Must be non-empty. |

### Resolution

The policy from the example above:

| Viewer | Role | Scope applied |
|--------|------|---------------|
| `buyer@acme.com` | viewer | `company_id IN (1, 2)` — email rule `[1]` ∪ domain rule `[1, 2]` |
| `ceo@acme.com` | viewer | `company_id IN (1, 2)` — domain rule only |
| `ops@globex.com` | viewer | `company_id IN (3)` |
| `someone@stranger.com` | viewer | no rows (`default: deny`, no match) |
| anonymous | — | no rows (`default: deny`) |
| owner / editor | owner/editor | all rows (policy bypassed) |

The scope is always **AND-ed** with whatever the page queries — it narrows, never widens. If the page sends `find({ company_id: 99 })` but the viewer's scope is `[1, 2]`, the result is empty.

## Worked example

A SaaS vendor shares one sales dashboard. Two customers must each see only their own rows.

### Data (multi-tenant table)

```json
[
  { "company_id": 1, "month": "2026-05", "revenue": 42000 },
  { "company_id": 2, "month": "2026-05", "revenue": 18000 },
  { "company_id": 3, "month": "2026-05", "revenue": 91000 }
]
```

### Artifact HTML

The page queries without any tenant filter — the server narrows automatically:

```html
<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="https://shareout.site/sdk/shareout.css">
  <script src="https://shareout.site/sdk/shareout.js"></script>
  <script type="shareout/manifest">
  {
    "version": "2.0",
    "sources": {
      "tables": {
        "sales": { "schema": [
          { "name": "company_id", "type": "number" },
          { "name": "month",      "type": "string" },
          { "name": "revenue",    "type": "number" }
        ] }
      }
    }
  }
  </script>
</head>
<body>
  <script>
    const sdk = new ShareOut();
    // No client-side tenant filter — the server enforces it.
    const rows = await sdk.table('sales').find().sort({ month: -1 }).toArray();
    // rows already contains ONLY the signed-in viewer's rows.
  </script>
</body>
</html>
```

### Publish

```bash
TOKEN=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.shareout/credentials')))['token'])")

python3 -c 'import json; print(json.dumps({
  "name": "customer-sales",
  "files": [{"path": "index.html", "content": open("index.html").read(), "mime": "text/html"}],
  "visibility": "private",
  "auth_method": "google",
  "share_with": ["buyer@acme.com", "ops@globex.com"],
  "access_policy": {
    "version": 1, "field": "company_id", "default": "deny",
    "rules": [
      {"match": {"domain": "acme.com"},   "values": [1, 2]},
      {"match": {"domain": "globex.com"}, "values": [3]}
    ]
  }
}))' | curl -sS -X POST 'https://shareout.site/v1/publish' \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @-
```

## Updating and clearing the policy

**Update without re-publishing HTML** — `PATCH` the artifact:

```http
PATCH /v1/artifacts/{artifact_id}
Authorization: Bearer {token}
Content-Type: application/json

{ "access_policy": { "version": 1, "field": "company_id", "default": "deny", "rules": [ … ] } }
```

**Clear the policy** (all viewers see everything again):

```http
PATCH /v1/artifacts/{artifact_id}
Content-Type: application/json

{ "access_policy": null }
```

:::caution[Re-publishing preserves the policy]
Publishing HTML without an `access_policy` field leaves the existing policy untouched — routine content updates never accidentally drop your security rule. To remove a policy, send `access_policy: null` via PATCH explicitly.
:::

Invalid policies are rejected at write time with `400 INVALID_ACCESS_POLICY` and a message naming the offending field.

## Viewer authentication

The policy needs a verified identity, so the artifact must require sign-in:

- `visibility: "private"` — anonymous visitors have no identity and, under `default: "deny"`, get no data.
- `auth_method: "google"` — viewers sign in with Google OAuth or a 6-digit email code; the Worker receives their verified email.
- `share_with: […]` — the access gate (who may open the artifact at all). The `access_policy` is the row filter (what each allowed viewer sees). These are two independent layers.

A viewer must pass both checks: in `share_with` (or workspace membership) **and** matched by a policy rule to receive rows.

## Data Platform (Snowflake / BigQuery)

For warehouse-backed dashboards, enforce the scope by writing the `:viewer_scope` placeholder in the query. The server substitutes the viewer's allowed values before execution:

```sql
SELECT month, revenue
FROM sales
WHERE company_id IN (:viewer_scope)
```

- A scoped viewer whose query omits `:viewer_scope` receives `403 SCOPE_REQUIRED` — fail-closed.
- An empty scope (denied viewer) resolves `:viewer_scope` to `NULL`, so `IN (NULL)` returns nothing.
- Direct execution mode is blocked for scoped viewers (it would hand credentials to the browser).
- The platform cache is segmented per scope — one viewer's filtered result is never served to another.
- Non-SQL providers (Google Sheets, Analytics, Shopify) have no `:viewer_scope` mechanism; scoped viewers are blocked from them.

## Backend coverage

| Backend | Under an access policy, a scoped viewer… |
|---------|------------------------------------------|
| `sdk.table()` | sees only in-scope rows; reads and writes filtered; out-of-scope `findById` → 404 |
| Data Platform — SQL (Snowflake, BigQuery) | must include `:viewer_scope`; otherwise `403 SCOPE_REQUIRED` |
| Data Platform — non-SQL (Sheets, GA, Shopify) | blocked (`403 SCOPE_REQUIRED`) |
| `sdk.json` | blocked (`403`) — owner/editor-only under a policy |
| `sdk.blobs`, `sdk.realtime`, `sdk.comments` | not scoped — do not store per-tenant secret data there |

## Security boundaries

What the policy guarantees:

- Every `sdk.table()` read and write path is filtered — `find`, `count`, `distinct`, `findById`, `update`, `delete`. No path bypasses the scope clause.
- The scope AND-s with the client filter; it can only narrow.
- Data Platform SQL is fail-closed: missing `:viewer_scope` for a scoped viewer → `403`.
- Owner/editor bypass is determined from the server-verified session, not from anything the client sends.

What it does **not** protect:

- **Anything baked into the published HTML/JS** is visible to every authorized viewer. Per-viewer secret content must come through `sdk.table()`, keyed by the policy field.
- **Domain matching trusts the email domain.** Do not use `domain` rules for shared consumer domains (`gmail.com`, `outlook.com`) — use explicit `email` rules there.
- **`sdk.blobs`, `sdk.realtime`, and `sdk.comments`** are not scoped. Do not store per-tenant secret data in them.

## Local testing

Run the worker locally then simulate different viewers with the `/auth/dev` helper:

```bash
open "http://localhost:55162/auth/dev?email=buyer@acme.com&redirect=/a/customer-sales"
# In another browser profile:
open "http://localhost:55162/auth/dev?email=ops@globex.com&redirect=/a/customer-sales"
```

Leak probe — confirm the server narrows even when the client requests an out-of-scope row:

```bash
curl -sS -X POST 'http://localhost:55162/v1/data/{artifact_id}/tables/sales/query' \
  -H 'Content-Type: application/json' --cookie 'shareout_session=…' \
  --data '{"filter": {"company_id": 3}}'   # as Acme viewer → returns []
```

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Viewer sees no rows | No rule matches their email/domain and `default` is `deny`; or rows don't carry the `field`; or the `field` name in the policy differs from the JSON key in the rows. |
| Viewer sees all rows | `default: "allow"`; or they are an owner/editor (bypass); or the artifact is not `private`. |
| Policy change not taking effect | Artifact metadata is cached ~5 min. Publish and PATCH bust the cache automatically. |
| `400 INVALID_ACCESS_POLICY` on publish | Malformed policy — message names the bad field. |
| Re-publish "lost" my policy | It didn't. Omitting `access_policy` preserves it; send `access_policy: null` via PATCH to clear. |

## Checklist

- [ ] Every row carries the tenant field (e.g. `company_id` on every row).
- [ ] Artifact is `visibility: "private"`, `auth_method: "google"`.
- [ ] `share_with` lists all viewer emails (the access gate).
- [ ] `access_policy.field` exactly matches the JSON key in the rows.
- [ ] `default: "deny"` unless unmatched viewers should see everything.
- [ ] No per-viewer secret data hardcoded in the HTML.
- [ ] Tested as two different viewers and as owner; ran a leak probe.
