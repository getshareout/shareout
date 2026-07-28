---
title: Authentication
description: How to authenticate requests to the ShareOut API.
---

import { Aside } from '@astrojs/starlight/components';

Write endpoints need a token. Read access to public artifacts doesn't.

## Bearer token

Send your token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer so_your_token_here" \
  "$ORIGIN/v1/artifacts"
```

Tokens look like `so_…`. Keep them secret — anyone with your token can publish as
you.

### Where to store it

The CLI and example scripts read from `~/.shareout/credentials`:

```json title="~/.shareout/credentials"
{
  "token": "so_your_token_here",
  "origin": "https://shareout.<your-account>.workers.dev"
}
```

`$ORIGIN` is that `origin` field (no trailing slash).
## Workspace Agent tokens (service accounts)

For a non-human caller — a customer's AI agent, a backend service, or CI/CD — use a
**workspace Agent token** (prefix `sot_`) instead of a personal `so_` token. It
authenticates as a headless **service principal** scoped to one workspace, with action
scopes (`artifacts:read`, `artifacts:publish`, `data:read`, `data:write`), and is
revocable independently of any employee.

Mint one as a workspace owner/admin, then use it exactly like a personal token:

```bash
curl -X POST "$ORIGIN/v1/workspaces/{workspace_id}/agent-tokens" \
  -H "Authorization: Bearer so_admin_token" -H "Content-Type: application/json" \
  -d '{ "name": "CI bot", "scopes": ["artifacts:publish", "data:write"] }'
# → { "token": "sot_…", "shown_once": true, … }
```

See [Teams API → Agent tokens](/teams/api/#agent-tokens-service-accounts) for list and
revoke. A missing scope returns `403 INSUFFICIENT_SCOPE`.

## Device login (CLI / agents)

For a user who **already has a ShareOut account** — especially someone **invited
to a workspace by email** — anonymous `create-account` creates a fresh headless
account instead of joining their real one. **Device login** signs them in via
Google in the browser and returns an `so_` token to the CLI.

```
CLI  → POST /v1/auth/device/start
     ← { device_code, user_code, verification_uri_complete, interval, expires_in }
User → opens verification_uri_complete, continues with Google
CLI  → POST /v1/auth/device/token { device_code }  (poll every interval seconds)
     ← { status: "approved", token: "so_…", user_id, warn? }
CLI  → save token to ~/.shareout/credentials
```

- `device_code` is the secret held by the CLI; `user_code` is the short code shown
  in the browser. Never send `device_code` to the user.
- Codes expire in **10 minutes**. Poll no faster than the returned `interval` (5s).
  The token is delivered **once** — the pending row is consumed on the first
  approved poll.
- Optional body on start: `{ "expected_email": "invited@company.com" }`. Passed to
  Google as `login_hint` so the right account is pre-selected, and used to emit a
  precise `warn` if the user signs in as a different email.
- **Copy-paste fallback:** the browser success page shows the token when the CLI
  cannot poll.

```http
POST /v1/auth/device/start
Content-Type: application/json

{ "expected_email": "invited@company.com" }
```

```http
POST /v1/auth/device/token
Content-Type: application/json

{ "device_code": "…" }
```

Pending polls return `{ "status": "pending", "interval": 5 }`. Approved polls
return `{ "status": "approved", "token": "so_…", "user_id": "usr_…", "warn"?: "…" }`.

## Session cookies (browser)

Requests from a logged-in browser session are also accepted via cookie, set by
the Google sign-in flow:

- `shareout_session` — Google auth
- `shareout_access` — password / credentials auth

For server-to-server calls, prefer the bearer token.

## Linked accounts

You can link multiple Google sign-ins to one ShareOut identity (Settings → Linked
accounts). After linking, artifacts owned by any linked identity count as **yours**
for ownership, visibility, and editor access — you do not need a separate collaborator
invite on pages you already own under a linked email.

<Aside type="caution" title="Cloudflare protection">
ShareOut runs behind Cloudflare. Python `requests` can trigger a `1010` block.
Build your payload in Python and pipe it to `curl` — see the
[Quickstart](/start/quickstart/).
</Aside>

## Rate limits

| Endpoint | Limit |
| --- | --- |
| Publish | 60 / hour per user |
| Data API | 1000 / min per artifact |
| Email | 50 / day per user, 10 / day per artifact |
| CORS proxy | 100 / min per artifact |

Exceeding a limit returns `429` with code `RATE_LIMITED`.
