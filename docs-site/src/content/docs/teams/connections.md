---
title: Workspace connections
description: Define reusable team data sources — shared credentials or per-user tokens — for any artifact in a workspace.
---

import { Aside } from '@astrojs/starlight/components';

Workspace connectors are reusable data sources defined once at the workspace
level. Artifacts reference them **by name** — credentials are never copied
into published HTML.

## Credential scope

| Pattern | `credentialScope` | Admin provides | Each member provides | Example |
| --- | --- | --- | --- | --- |
| Shared team connector | `shared` (default) | Endpoint + one token | Nothing | Snowflake service account, team Slack bot |
| Per-user connector | `per_user` | Endpoint + auth shape | Their own API token | GraphQL API scoped to the logged-in user |

Use `per_user` when the upstream API authenticates the person, not the
organization. Use `shared` when one service account covers the whole team.

In the redesigned Home, open the **Connectors** lens in the left rail to list,
create, OAuth-install, and test connectors without leaving the workspace surface.

<Aside>
Scheduled cron jobs run without a viewer identity and cannot refresh
`per_user` connectors. Use `shared` connectors for nightly materialize runs.
</Aside>

## Roles

| Action | `owner` / `admin` | `member` |
| --- | --- | --- |
| List connectors | ✓ | ✓ |
| Create / delete connectors | ✓ | |
| OAuth-install platform connectors | ✓ | |
| Save own credentials (`per_user` only) | ✓ | ✓ |

## Admin: create a shared connector

```http
POST /v1/workspaces/{workspaceId}/connections
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "team_mixpanel",
  "type": "rest_api",
  "credentialScope": "shared",
  "config": {
    "baseUrl": "https://mixpanel.com/api/2.0",
    "apiKeyHeader": "Authorization",
    "apiKeyPrefix": "Basic "
  },
  "credentials": {
    "type": "api_key",
    "data": { "apiKey": "base64-service-credential" }
  }
}
```

## Admin: create a per-user connector

Admin defines the endpoint and auth shape. Do **not** send `credentials.data`.

```http
POST /v1/workspaces/{workspaceId}/connections
Authorization: Bearer {token}
Content-Type: application/json

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

`authType` must be one of: `api_key`, `basic_auth`, `service_account`.

## Member: save personal credentials

```http
PUT /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials
Authorization: Bearer {token}
Content-Type: application/json

{
  "credentials": {
    "type": "api_key",
    "data": { "apiKey": "member-personal-token" }
  }
}
```

Check status (no secret values returned):

```http
GET /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials
```

```json
{ "configured": true, "authType": "api_key", "updatedAt": "2026-06-15T12:00:00.000Z" }
```

Revoke:

```http
DELETE /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials
```

The `GET /connections` list includes `hasMyCredentials: true|false` on each
`per_user` connector.

## Artifact runtime

```javascript
const sdk = await ShareOut.create();

const body = await sdk.connection('acme_graphql').fetch('', {
  query: {
    endpoint: '',
    method: 'POST',
    body: {
      query: `query Adoption($id: ID!) { company(id: $id) { name } }`,
      variables: { id: '743' }
    }
  },
  cache: false
});
```

The server injects the viewer's saved token. If no token is saved the request
returns `403 CREDENTIALS_REQUIRED`.

## Platform connectors (catalog)

Browse the always-visible provider catalog in workspace admin. Most providers use
**bring-your-own credentials** — paste your token or service-account key, run
**Test**, then save. Supported platform providers include Google Analytics,
Google Ads, Facebook Ads, Shopify, Tienda Nube, Google Sheets, Snowflake,
BigQuery, and Slack.

Each catalog entry exposes `docsUrl`, an `exampleSnippet` with your connector
name, and whether it is `testable`.

### Test credentials before saving

```http
POST /v1/workspaces/{workspaceId}/connections/test
Authorization: Bearer {token}
Content-Type: application/json

{
  "provider": "google-analytics",
  "config": { "propertyId": "123456789" },
  "credentials": { "type": "service_account", "data": { "key": { … } } }
}
```

Returns `{ "ok": true }` or an error with a provider-specific message. Admin+ only.

### OAuth install flows (Slack)

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/workspaces/{id}/connections/slack/install?connection={name}` | Slack install (302). |
| `GET /v1/workspaces/{id}/connections/{connectionId}` | Admin detail (no secrets). |

Platform connectors can use `credentialScope: "per_user"` for per-member GCP
service accounts or OAuth refresh tokens.

### Workspace assistant queries

Admins can enable **AI query** per connector so the [workspace assistant](/teams/workspace-assistant/)
can run ad-hoc read-only `SELECT` statements against warehouse connectors:

```http
PATCH /v1/workspaces/{workspaceId}/connections/{connectionId}
Authorization: Bearer {token}
Content-Type: application/json

{ "agent_query_enabled": true }
```

Off by default. Use read-only credentials. Toggle in the connectors admin UI
(**AI query: On/Off**).

### Server-side warehouse execution

Generic **Snowflake** and **BigQuery** workspace connectors (inline credentials,
not platform OAuth) execute on the server for:

- `query_snapshot` and other scheduled materialize deliveries
- Connection test (`POST /v1/workspaces/{id}/connections/test`)

Postgres warehouse connectors still require an external pre-fetch until a Workers
engine ships. REST and platform OAuth connectors are unchanged.

## Endpoint summary

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/connections` | Member+ | List. No secrets. |
| `POST` | `/v1/workspaces/{id}/connections` | Admin+ | Create. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Detail. |
| `DELETE` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Delete; cascades member credentials. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}/artifacts` | Member+ | Artifacts that queried this connector. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Per-user status. |
| `PUT` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Save own token. |
| `DELETE` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Remove own token. |
| `POST` | `/v1/workspaces/{id}/connections/test` | Admin+ | Verify pasted credentials without saving. |
| `PATCH` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Toggle `agent_query_enabled`. |
| `GET` | `/v1/oauth/slack/callback` | — | Slack OAuth callback. |

## Errors

| Code | Meaning |
| --- | --- |
| `403 CREDENTIALS_REQUIRED` | Member queried a `per_user` connector before saving `my-credentials`. |
| `400 NOT_PER_USER` | `my-credentials` called on a `shared` connector. |
