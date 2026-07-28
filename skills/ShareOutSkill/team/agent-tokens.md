# Workspace Agent Tokens (Service Accounts)

A **workspace Agent token** is a non-human credential scoped to **one workspace**. Use it
when a customer's AI agent, a backend service, or a CI/CD pipeline needs to publish
artifacts or read/write data **as itself** — not as an employee's personal token.

Why not a personal `so_` token: a personal token dies when the employee leaves, carries
that human's access across *every* workspace they belong to, has no action scopes, and
shows up in audit/activity as the person. An Agent token fixes all four.

## Identity model

Each Agent token authenticates as a **service principal** — a headless, first-class
**member** of the workspace. It owns the artifacts it publishes (`owner_id` = the
principal), appears in the members and activity surfaces (flagged `is_agent: true`), and
is attributable and revocable independently of any person. Confined to its workspace:
it cannot read or write artifacts in any other workspace.

Token prefix is **`sot_`** (vs personal `so_`). Plaintext is shown **once** at mint and
never recoverable.

## Scopes

Action scopes, chosen per token (least privilege):

| Scope | Grants |
| --- | --- |
| `artifacts:read` | GET artifact metadata via REST (`GET /v1/artifacts…`) |
| `artifacts:publish` | `POST /v1/publish` |
| `data:read` | Read an artifact's data stores (json/tables/blobs) |
| `data:write` | Write an artifact's data stores |

A token with `data:read` but not `data:write` can read data but every mutation is
refused. Artifact REST mutations beyond publish (delete, collaborators, share, …) are
**not** grantable to Agent tokens in v1.

## Manage tokens (owner/admin only)

Mint:

```bash
curl -X POST $ORIGIN/v1/workspaces/{workspace_id}/agent-tokens \
  -H "Authorization: Bearer <admin so_ token or session>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "CI bot", "scopes": ["artifacts:publish", "data:write"] }'
# → { "ok": true, "token": "sot_…", "shown_once": true, "token_id": "sot_…", "principal_user_id": "usr_…", "scopes": [...] }
```

Optional `expires_at` (ISO datetime) sets an expiry; omit for none.

List (metadata only):

```bash
curl $ORIGIN/v1/workspaces/{workspace_id}/agent-tokens \
  -H "Authorization: Bearer <admin token>"
```

Revoke (soft — the principal keeps its artifacts; mint a new token to re-enable):

```bash
curl -X DELETE $ORIGIN/v1/workspaces/{workspace_id}/agent-tokens/{token_id} \
  -H "Authorization: Bearer <admin token>"
```

## Use the token

Identical to a personal token — just send it as the Bearer credential:

```bash
curl -X POST $ORIGIN/v1/publish \
  -H "Authorization: Bearer sot_…" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Nightly dashboard", "workspace_id": "wsp_…", "files": { … } }'
```

Errors: `403 INSUFFICIENT_SCOPE` when the token lacks the required scope; `401` after
revocation or expiry.
