# Teams Workspace Connectors

Workspace connectors are **reusable data sources** defined once at the workspace level. Any artifact in the workspace references them by **name** — credentials are not copied into each artifact.

Load [SKILL.md](SKILL.md) first. For artifact runtime (`sdk.connection`, live GraphQL/REST), also read [../sdk/live-data.md](../sdk/live-data.md) and [../sdk/connections.md](../sdk/connections.md).

In Home, open the **Connectors** lens in the left rail to list, create, and OAuth-install connectors without leaving the workspace shell.

## When To Use Which Scope

| Pattern | `credentialScope` | Admin provides | Each member provides | Example |
| --- | --- | --- | --- | --- |
| **Shared team connector** | `shared` (default) | Endpoint + one token | Nothing | Snowflake service account, team Slack bot, shared Mixpanel project key |
| **Per-user connector** | `per_user` | Endpoint + auth shape only | Their own API token | GraphQL API where each user sees data scoped to their login |
| **Artifact-local connector** | — (not a workspace connector) | Owner only, per artifact | — | One-off demo key on a personal artifact |

Use **`per_user`** when the upstream API authenticates **the person**, not the organization. Use **`shared`** when one service account or OAuth app represents the whole team.

> **Scheduled jobs:** cron `materialize` jobs run without a viewer identity. They cannot refresh **per-user** connectors — use **shared** connectors, inline `rows`, or owner-scoped materialize from an interactive session. See [../api/jobs.md](../api/jobs.md).

## Roles

| Action | Workspace `owner` / `admin` | Workspace `member` |
| --- | --- | --- |
| List connectors | ✓ | ✓ |
| Create / delete connectors | ✓ | |
| OAuth-install platform connectors (Slack, Shopify, …) | ✓ | |
| Save **my** credentials (`per_user` only) | ✓ | ✓ |
| Query **shared** generic connector from an artifact | Artifact owner only | |
| Query **shared** platform connector from an artifact | Artifact owner or member (if not `is_private`) | Same |
| Query **per_user** generic connector from an artifact | ✓ (with own token saved) | ✓ (with own token saved) |

Platform connectors (`kind: platform`) support OAuth providers (Snowflake, BigQuery, Google Sheets, Shopify, Slack, …). Generic connectors (`kind: generic`, `type: rest_api`, …) cover REST and **GraphQL** (POST + JSON body).

---

## Admin: Create A Shared Connector

Requires workspace `owner` or `admin`.

```http
POST /v1/workspaces/{workspaceId}/connections
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "name": "team_mixpanel",
  "type": "rest_api",
  "credentialScope": "shared",
  "config": {
    "baseUrl": "https://mixpanel.com/api/2.0",
    "apiKeyHeader": "Authorization",
    "apiKeyPrefix": "Basic ",
    "headers": {
      "X-Project-Context": "team-dashboard"
    }
  },
  "credentials": {
    "type": "api_key",
    "data": { "apiKey": "base64-encoded-service-credential" }
  }
}
```

List connectors (any member; **no secret values**):

```http
GET /v1/workspaces/{workspaceId}/connections
```

Response includes `credentialScope`, `authType`, `config`, and `usageCount` (how many artifacts have queried this connector).

---

## Admin: Create A Per-User Connector

Admin defines **where** and **how** to authenticate — members supply **their** token later.

```http
POST /v1/workspaces/{workspaceId}/connections
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "name": "acme_graphql",
  "type": "rest_api",
  "credentialScope": "per_user",
  "authType": "api_key",
  "config": {
    "baseUrl": "https://api.example.com/graphql",
    "apiKeyHeader": "Authorization",
    "apiKeyPrefix": "Bearer "
  }
}
```

Rules:

- Do **not** send `credentials.data` when `credentialScope` is `per_user`.
- `authType` (or `credentials.type` without `data`) must be one of: `api_key`, `basic_auth`, `service_account`.
- `config.headers` — optional static string headers merged on every request (e.g. API context headers). Auth header (`apiKeyHeader` / basic auth) is applied after and takes precedence on the same key.
- `name` is what artifacts pass to `sdk.connection('acme_graphql')`.

---

## Member: Save Personal Credentials

Any workspace member with a saved session or API token:

```http
PUT /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "credentials": {
    "type": "api_key",
    "data": { "apiKey": "member-personal-token" }
  }
}
```

`credentials.type` must match the connector's `authType`.

Check status (no secret values returned):

```http
GET /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials
```

```json
{
  "configured": true,
  "authType": "api_key",
  "updatedAt": "2026-06-15T12:00:00.000Z"
}
```

Revoke:

```http
DELETE /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials
```

List response also includes `hasMyCredentials: true|false` on each `per_user` connector so UIs can prompt "Connect your token".

---

## Artifact Runtime: GraphQL (Per-User REST)

Published HTML must use `ShareOut.create()` — see [../sdk/live-data.md](../sdk/live-data.md).

```javascript
const sdk = await ShareOut.create();

const body = await sdk.connection('acme_graphql').fetch('', {
  query: {
    endpoint: '',
    method: 'POST',
    body: {
      query: `query Adoption($companyId: ID!) { company(id: $companyId) { name adoption { enabled utilized } } }`,
      variables: { companyId: '743' }
    }
  },
  cache: false
});
```

- Empty `endpoint` hits `config.baseUrl` directly (standard single-endpoint GraphQL).
- Server injects the **viewer's** saved token — never embed tokens in HTML.
- If the viewer has not saved credentials: `403` with `code: "CREDENTIALS_REQUIRED"`.
- Cache keys are **per user** — one member's query result never serves another.

For shared REST connectors the same `sdk.connection(name).fetch()` API applies; auth rules differ (artifact owner only for generic shared connectors today).

---

## Platform Connectors (OAuth / Warehouses / BYO paste)

Create via admin API with `kind: "platform"` or from the **always-visible provider catalog** in workspace admin. Most providers use **bring-your-own credentials** — paste your token or service-account key, run **Test**, then save. Supported platform providers include Google Analytics, Google Ads, Facebook Ads, Shopify, Tienda Nube, Google Sheets, Snowflake, BigQuery, and Slack.

Each catalog entry exposes `docsUrl`, an `exampleSnippet` with your connector name, and whether it is `testable`.

### Test credentials before saving

```http
POST /v1/workspaces/{workspaceId}/connections/test
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "provider": "google-analytics",
  "config": { "propertyId": "123456789" },
  "credentials": { "type": "service_account", "data": { "key": { } } }
}
```

Returns `{ "ok": true }` or an error with a provider-specific message. Admin+ only.

### OAuth install flows

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/workspaces/{id}/connections/{provider}/auth-url?connection={name}` | Start OAuth |
| `GET /v1/workspaces/{id}/connections/slack/install?connection={name}` | Slack install (302) |
| `GET /v1/workspaces/{id}/connections/{connectionId}` | Admin detail (no secret values) |

Query from artifacts via `sdk._internalFetch('/platform/…')` or `sdk.connection(name)` for token-shim providers — see [../sdk/live-data.md](../sdk/live-data.md) and provider docs ([../integrations/facebook-ads.md](../integrations/facebook-ads.md), [../integrations/google-ads.md](../integrations/google-ads.md)).

**`is_private`:** workspace platform connectors default to team-shared execution (`is_private = 0`). Set `is_private = 1` to restrict live queries to the artifact owner only (reserved credentials).

### Workspace assistant queries

Admins can enable **AI query** per connector so the [workspace assistant](workspace-assistant.md) can run ad-hoc read-only `SELECT` statements against warehouse connectors:

```http
PATCH /v1/workspaces/{workspaceId}/connections/{connectionId}
Authorization: Bearer {token}
Content-Type: application/json

{ "agent_query_enabled": true }
```

Off by default. Use read-only credentials. Toggle in the connectors admin UI (**AI query: On/Off**).

### Per-user platform connectors

Platform connectors (`kind: "platform"`) can use `credentialScope: "per_user"` so each member supplies their own credentials via `my-credentials`. Supported per-user auth types:

| `credentials.type` | Use case | Required `data` fields (via my-credentials) |
| --- | --- | --- |
| `service_account` | GCP service account JSON key | `client_email`, `private_key` |
| `authorized_user` | Google user OAuth (gcloud ADC / refresh token) | `client_id`, `client_secret`, `refresh_token` |

Admin creates the connector **without** credential values:

```json
{
  "name": "my_bigquery",
  "provider": "bigquery",
  "credentialScope": "per_user",
  "credentials": { "type": "authorized_user" }
}
```

Each member then saves their own refresh token:

```http
PUT /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials
Authorization: Bearer {token}
Content-Type: application/json

{
  "credentials": {
    "type": "authorized_user",
    "data": {
      "client_id": "….apps.googleusercontent.com",
      "client_secret": "…",
      "refresh_token": "…"
    }
  }
}
```

Shared platform OAuth (`credentialScope: "shared"`) also accepts `authorized_user` at create time when the admin supplies the credential bundle directly.

Per-user credential storage for **generic** `rest_api` connectors uses `api_key`, `basic_auth`, or `service_account` — see [Member: Save Personal Credentials](#member-save-personal-credentials).

---

## Agent Checklist

When building a Teams dashboard that hits an API **per logged-in user**:

1. Confirm workspace is on **Teams** plan and artifact has `workspace_id` set.
2. Ask admin to create a **`per_user`** connector (name, `baseUrl`, header config).
3. Tell each member to `PUT …/my-credentials` once (or build UI that calls it).
4. Publish artifact with `visibility: "workspace"` if all members should open it.
5. Use `await ShareOut.create()` + `sdk.connection(name)` — never raw `fetch` to `/v1/data/…`.
6. Handle `CREDENTIALS_REQUIRED` in UI copy ("Connect your API token in workspace settings").
7. Do **not** use per-user connectors for nightly cron materialize — materialize interactively or use a shared connector.

---

## Related

- [api.md](api.md#workspace-connections) — endpoint table
- [../sdk/connections.md](../sdk/connections.md) — `query`, `fetch`, `materialize`
- [../sdk/live-data.md](../sdk/live-data.md) — sandbox auth, GraphQL POST shape
- [../integrations/overview.md](../integrations/overview.md) — platform OAuth providers
- [../api/jobs.md](../api/jobs.md) — scheduled materialize limits
- [workspace-context.md](workspace-context.md) — document connector names in `data.md` for agents
