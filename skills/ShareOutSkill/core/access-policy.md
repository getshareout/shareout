# Row-Level Access Policy

Share **one** artifact externally and have each authenticated viewer see **only their own slice** of the data — each customer sees only their `company_id`, each prospect only their `pitch`, each region lead only their `region`. Filtering is enforced **server-side at the data layer**, so it cannot be bypassed from the browser.

> **Why this must be server-side.** A ShareOut HTML artifact runs in the viewer's browser and is fully inspectable — they can read the JS, open devtools, and call the `/v1/data/...` endpoints directly with any filter they like. So a filter written in your page (`sdk.table('sales').find({ company_id: 1 })`) is **cosmetic** — it does not protect anything. The access policy is enforced inside the Cloudflare Worker, *after* the viewer is identified and *before* any row is returned. The viewer cannot widen it.

---

## When to use

| You want… | Use this? |
|-----------|-----------|
| One dashboard/report/deck shared with multiple external customers, each seeing only their own data | ✅ Yes |
| A pitch deck where each prospect sees only their tailored numbers | ✅ Yes |
| Internal tool where every collaborator should see everything | ❌ No — just use [collaborators](../modules/_shared/permissions.md) |
| Hide *which other tenants exist* (not just their rows) | ✅ Yes — `default: "deny"` returns nothing to unmatched viewers |
| Per-viewer **secret content baked into the HTML** | ❌ Not possible — see [Security model](#security-model). Secret content must come through the data layer. |

---

## How it works (request flow)

```
Author (owner)                     Viewer (external customer)
─────────────                      ──────────────────────────
1. Publish artifact                3. Opens private artifact URL
   visibility: private                → signs in with Google or email OTP
   auth_method: google                → Worker now has VERIFIED email
   share_with: [emails]
   access_policy: { ... }          4. Page calls sdk.table('sales').find()
                                       → POST /v1/data/{id}/tables/sales/query
2. Policy stored on the            5. Worker resolves email/domain → allowed
   artifact (server-side,             values, then runs:
   never read from HTML)                WHERE <client filter> AND company_id IN (...)
                                    6. Only in-scope rows returned. No leak.
```

The owner/editor who builds the artifact **bypasses** the policy and sees all data (so you can author and QA). The policy applies only to **viewer-role** collaborators and external sign-ins.

**Enforced** on `sdk.table()` (every read *and* write path), the Data Platform (Snowflake/BigQuery/… via the `:viewer_scope` placeholder — see [Data Platform](#data-platform-snowflake--bigquery)), and `sdk.json` (owner-only under a policy). See the [coverage table](#backend-coverage).

---

## Policy schema

Attach an `access_policy` object to the artifact. Stored server-side; updatable without re-publishing.

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

| Key | Type | Meaning |
|-----|------|---------|
| `version` | `1` | Schema version. Must be `1`. |
| `field` | string | The **row field** to filter on. Any field your table data contains — `company_id`, `pitch`, `region`, `tenant`, etc. Must match the JSON key stored in each row. |
| `default` | `"deny"` \| `"allow"` | What happens to a viewer matching **no** rule. `"deny"` → they see **zero rows** (recommended). `"allow"` → unfiltered (they see everything). |
| `rules` | array | Ordered list of match→values rules. A viewer accumulates the **union** of `values` from **all** rules they match. |
| `rules[].match.email` | string | Exact email match, case-insensitive. |
| `rules[].match.domain` | string | Email-domain match, case-insensitive (`buyer@acme.com` → domain `acme.com`). A rule may set `email` or `domain` (at least one). |
| `rules[].values` | array of string\|number | Allowed values of `field` for a matching viewer. Non-empty. |

### Resolution semantics (truth table)

Given the policy above, the scope applied to each read:

| Viewer | Role | Result |
|--------|------|--------|
| `buyer@acme.com` | viewer | `company_id IN (1, 2)` — email rule `[1]` ∪ domain rule `[1,2]` |
| `ceo@acme.com` | viewer | `company_id IN (1, 2)` — matches domain rule only |
| `ops@globex.com` | viewer | `company_id IN (3)` |
| `someone@stranger.com` | viewer | **no rows** (`default: deny`, no match) |
| *not signed in* | anonymous | **no rows** (`default: deny`) |
| owner / editor | owner/editor | **all rows** (policy bypassed) |

With `default: "allow"`, the two "no rows" lines above become "all rows" instead.

> **Key invariant:** the policy is **AND-ed** with whatever the page queries — it always **narrows**, never widens. If the page sends `find({ company_id: 99 })` but the viewer's scope is `[1,2]`, the result is empty (intersection), not company 99's data.

---

## Worked example: customer dashboard

A SaaS vendor shares a single sales dashboard with two customers. Each customer must see only their own company's rows.

### 1. The data (one table, mixed tenants)

The owner materializes/inserts rows that **carry the tenant field** (`company_id`):

```json
[
  { "company_id": 1, "month": "2026-05", "revenue": 42000 },
  { "company_id": 2, "month": "2026-05", "revenue": 18000 },
  { "company_id": 3, "month": "2026-05", "revenue": 91000 }
]
```

### 2. The HTML artifact

The page queries the table **normally** — no filtering logic needed. The server narrows the result to the viewer's scope automatically.

```html
<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="$ORIGIN/sdk/shareout.css">
  <script src="$ORIGIN/sdk/shareout.js"></script>
  <script type="shareout/manifest">
  {
    "version": "2.0",
    "sources": {
      "tables": {
        "sales": { "schema": [
          { "name": "company_id", "type": "number" },
          { "name": "month", "type": "string" },
          { "name": "revenue", "type": "number" }
        ] }
      }
    }
  }
  </script>
</head>
<body>
  <h1 class="so-h1">Sales</h1>
  <div data-shareout-page="main">
    <table class="so-table"><tbody data-shareout-binding="rows"></tbody></table>
  </div>
  <script>
    const sdk = new ShareOut();
    // No client-side tenant filter — the server enforces it. We just query all.
    const rows = await sdk.table('sales').find().sort({ month: -1 }).toArray();
    // `rows` already contains ONLY the signed-in viewer's company rows.
    renderRows(rows);
  </script>
</body>
</html>
```

### 3. Publish with the policy

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
}))' | curl -sS -X POST '$ORIGIN/v1/publish' \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @-
```

### 4. Result

- `buyer@acme.com` opens the URL → sees only `company_id` 1 and 2.
- `ops@globex.com` → sees only `company_id` 3.
- The owner (your account) → sees all three.
- Anyone else who somehow authenticates → sees nothing.

---

## Setting, updating, and clearing the policy

**At publish** — top-level `access_policy` field (see above).

**Update later, without re-publishing the HTML** — `PATCH` the artifact:

```http
PATCH /v1/artifacts/{artifact_id}
Authorization: Bearer {token}
Content-Type: application/json

{ "access_policy": { "version": 1, "field": "company_id", "default": "deny", "rules": [ ... ] } }
```

**Clear the policy** (make the artifact open to all its viewers again):

```http
PATCH /v1/artifacts/{artifact_id}
{ "access_policy": null }
```

> ⚠️ **Re-publishing the HTML without an `access_policy` field leaves the existing policy untouched** (so a routine content update never accidentally drops your security rule). To *remove* a policy you must explicitly send `access_policy: null` via PATCH.

Invalid policies are rejected at write time with `400 INVALID_ACCESS_POLICY` and a message naming the offending field.

---

## Viewer authentication setup

The policy needs to know **who** the viewer is, so the artifact must require sign-in:

- `visibility: "private"` — anonymous visitors get no identity (and, under `default: deny`, no data).
- `auth_method: "google"` — viewers sign in with **Google OAuth or a 6-digit email code** on the artifact login page; the Worker gets their **verified** email (see [auth.md](../auth.md#google-oauth-or-email-one-time-code)).
- `share_with: [...]` — the emails allowed to open the artifact at all (the access *gate*). The `access_policy` then decides *what each of them sees* (the row *filter*). These are two layers: `share_with` lets them in the door; `access_policy` decides which rows they get.

A viewer must be both in `share_with` (or matched by workspace membership) **and** matched by a policy rule to see rows.

---

## Local testing

Run the worker locally (it talks to real prod D1/R2/KV — see project `CLAUDE.md`), then simulate different viewers with the `/auth/dev` helper:

```bash
# Sign in as an Acme viewer, then open the artifact
open "http://localhost:55162/auth/dev?email=buyer@acme.com&redirect=/a/customer-sales"

# In another browser/profile, sign in as Globex
open "http://localhost:55162/auth/dev?email=ops@globex.com&redirect=/a/customer-sales"
```

**Verify:**
1. Acme viewer sees only companies 1–2; Globex viewer sees only company 3.
2. Your owner account (API token / owner session) sees all rows.
3. **Leak probe** — hit the data endpoint directly trying to widen the filter; confirm the server still narrows to scope:
   ```bash
   curl -sS -X POST 'http://localhost:55162/v1/data/{artifact_id}/tables/sales/query' \
     -H 'Content-Type: application/json' --cookie 'shareout_session=...' \
     --data '{"filter": {"company_id": 3}}'   # as an Acme viewer → returns [] (not Globex data)
   ```

---

## Security model

What the policy **guarantees**:

- `sdk.table()` enforcement runs in the Worker on **every read and write path** — `query`/`find`, `count`, `distinct`, `findById`, and `update`/`delete` (by id or filter). No path returns or mutates rows outside the scope clause; a viewer cannot widen the scope, and `findById`/`updateById`/`deleteById` of an out-of-scope row 404s.
- The scope is **AND-ed** with the client filter — it can only narrow.
- Data Platform SQL queries are **fail-closed**: no `:viewer_scope` → `403`. Direct mode is blocked for scoped viewers, and the cache is segmented per scope.
- Owner/editor bypass is determined from the **server-verified** session/role, not from anything the client sends.

What it does **not** protect — read these carefully:

- **Anything baked into the published HTML/JS is visible to every authorized viewer.** If customer A's secret numbers are hardcoded in the page, customer B can read them in the source. **Per-viewer secret content must come through `sdk.table()`** (the enforced layer), keyed by the policy `field`.
- **Domain matching trusts the email's domain.** Fine for corporate customers on their own domain; **do not** use `domain` rules for shared/consumer domains (`gmail.com`, `outlook.com`) — anyone with such an address would match. Use explicit `email` rules there.
- **`sdk.blobs`, `sdk.realtime`, and `sdk.comments` are not scoped** — don't store per-tenant secret data in them. (`sdk.json` is blocked entirely for scoped viewers.)

---

## Data Platform (Snowflake / BigQuery)

For warehouse-backed dashboards, the policy is enforced by binding the viewer's scope into the query. **The author must write the query with the `:viewer_scope` placeholder** — the server substitutes the viewer's allowed values into it before running the query:

```sql
SELECT month, revenue
FROM sales
WHERE company_id IN (:viewer_scope)   -- server replaces :viewer_scope with the viewer's values
```

- A scoped (non-owner) viewer running a query that does **not** contain `:viewer_scope` is **rejected** with `403 SCOPE_REQUIRED` — fail-closed, so unfiltered tenant data can never escape.
- The values come from the policy (author-defined, trusted); the server escapes them. A denied viewer's `:viewer_scope` becomes `NULL`, so `IN (:viewer_scope)` returns nothing.
- **Direct execution mode is blocked** for scoped viewers (it would hand credentials to the browser, bypassing the server filter) — these queries run in proxy mode.
- The **platform cache is segmented per scope**, so one viewer's filtered result is never served to another.
- Owners/editors are unscoped: their queries run as written (no `:viewer_scope` required).

> Because enforcement is fail-closed, **every** platform query a scoped viewer makes must carry `:viewer_scope` — even queries over non-tenant reference data. If a query genuinely needs no filtering, it's still blocked for viewers; keep such calls owner-only or move the data into a public table.

Non-SQL providers (Google Sheets, Analytics, Shopify) have no `:viewer_scope` mechanism, so scoped viewers are blocked from them under a policy (see below).

## Backend coverage

| Backend | Under an access policy, a scoped viewer… |
|---------|------------------------------------------|
| `sdk.table()` | sees only in-scope rows (reads **and** writes filtered; out-of-scope `findById` → 404) |
| Data Platform — SQL (Snowflake, BigQuery) | must use `:viewer_scope`; otherwise `403 SCOPE_REQUIRED` |
| Data Platform — non-SQL (Sheets, GA, Shopify) | blocked (`403 SCOPE_REQUIRED`) — no scope mechanism |
| `sdk.json` | blocked (`403`) — key/value store is owner/editor-only under a policy |
| `sdk.blobs`, `sdk.realtime`, `sdk.comments` | **not** scoped — don't place per-tenant secret data there |

**Put per-viewer data in `sdk.table()` or a `:viewer_scope` SQL query** — those are the policy-enforced paths.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Viewer sees **no** rows | No rule matches their email/domain and `default` is `deny`; or their rows don't carry the `field`; or the `field` name in the policy ≠ the JSON key in the rows. |
| Viewer sees **all** rows | Policy is `default: "allow"`; or they're an owner/editor (bypass); or the artifact isn't `private` (no identity → check `visibility`/`auth_method`). |
| Policy change not taking effect | Artifact metadata is cached ~5 min. Publish and PATCH bust the cache automatically; if testing rapidly, wait or re-PATCH. |
| `400 INVALID_ACCESS_POLICY` on publish | Malformed policy — the message names the bad field (`version` must be `1`, each rule needs `email`/`domain` and non-empty `values`). |
| Re-publish "lost" my policy | It didn't — omitting `access_policy` preserves it. You only clear it by sending `access_policy: null` via PATCH. |

---

## Quick checklist

- [ ] Rows carry the tenant field (e.g. every row has `company_id`).
- [ ] Artifact is `visibility: "private"`, `auth_method: "google"`.
- [ ] `share_with` lists the viewer emails (the access gate).
- [ ] `access_policy.field` exactly matches the row JSON key.
- [ ] `default: "deny"` unless you intentionally want unmatched viewers to see everything.
- [ ] No per-viewer secret data hardcoded in the HTML.
- [ ] Tested as two different viewers + owner, and ran a leak probe.
