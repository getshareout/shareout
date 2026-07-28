# Workspace Subdomains

Workspaces can use `{workspace}.{your-apex}` as a branded home for workspace artifacts.
On self-host, apex is your `SHAREOUT_BASE_URL` host (see [../deploy/cloudflare.md](../deploy/cloudflare.md)).
Hosted example apex: `$ORIGIN_HOST`.

Load [SKILL.md](SKILL.md) first.

## Routing

| URL | Serves |
| --- | --- |
| `{workspace}.{apex}/` | **Membership-gated** workspace home — signed-in members land on Home; anonymous visitors redirect to sign in. |
| `{workspace}.{apex}/{artifact-slug}` | Artifact in that workspace. |
| `{workspace}.{apex}/{folder}/{artifact-slug}` | Artifact in a workspace folder. |

The apex path `$ORIGIN/workspace/{slug}/` typically **302-redirects** to the subdomain root.

Workspace artifacts can also be served through namespaced URLs like `$ORIGIN/@{workspace}/{artifact}`.

## Full product mirror

A subdomain is not just a public gallery — it is a **full mirror** of the apex app for that
workspace. These paths pass through unchanged so members can sign in, open Home, edit
artifacts, and call APIs from the branded host:

`/v1/`, `/auth/`, `/sdk/`, `/embed/`, `/t/`, `/a/`, `/p/`, `/@`, `/brand/`, `/wl/`,
`/settings/`, `/app/`, `/home`, `/create`

Use relative links inside artifacts and product UI so pages work on both hosts.

## Enable

```http
POST /v1/workspaces/{workspaceId}/subdomain
Authorization: Bearer {token}
Content-Type: application/json

{ "enabled": true }
```

Requirements:

- Workspace role `admin` or `owner`.
- `GET …/subdomain` reports `eligible` + `can_manage`.
- On **self-host**, eligibility is about instance/DNS config — **not** a paid plan. If not
  eligible, configure wildcard DNS and `SHAREOUT_BASE_URL` ([../deploy/cloudflare.md](../deploy/cloudflare.md)).

Response:

```json
{
  "success": true,
  "subdomain": "acme.example.com",
  "workspace_slug": "acme",
  "enabled": true
}
```

## Disable

```http
DELETE /v1/workspaces/{workspaceId}/subdomain
Authorization: Bearer {token}
```

## Check Status

```http
GET /v1/workspaces/{workspaceId}/subdomain
Authorization: Bearer {token}
```

Response:

```json
{
  "enabled": false,
  "subdomain": null,
  "workspace_slug": "acme",
  "eligible": true,
  "can_manage": true
}
```

- `eligible` — the workspace qualifies for a subdomain on this instance.
- `can_manage` — the caller can enable/disable it (`eligible` **and** role is `admin`/`owner`).

Use this endpoint — not plan/tier checkout — to decide whether to offer the subdomain control.

## Reserved Slugs

Do not use platform-reserved slugs such as `www`, `api`, `app`, `admin`, `cdn`, `static`, `mail`, `assets`, `support`, `help`, or `status`.

## Agent Rules

- Confirm eligibility with `GET …/subdomain` (`can_manage: true`) before enabling.
- Use relative links inside artifacts when they should work on both subdomain and apex URLs.
- Do not invent homepage/admin SDK methods; use documented workspace routes.
- Never suggest “upgrade to Teams” for subdomain on self-host.
