# MCP connector (Claude, ChatGPT)

ShareOut is a remote [MCP](https://modelcontextprotocol.io) server. People add it to
claude.ai, Claude Desktop or ChatGPT with **one URL** and sign in with their ShareOut
account — no API token to copy. Then they ask the AI app to make a page and get a link back.

```
$ORIGIN/mcp
```

`$ORIGIN` is the instance origin (for example `https://shareout.site`). The signed-in
connect page is `$ORIGIN/home?view=connect`.

## Add it

| App | Where |
| --- | --- |
| claude.ai / Claude Desktop | Settings → Connectors → **Add custom connector** → paste `$ORIGIN/mcp` → Connect |
| ChatGPT | Settings → Apps & Connectors → Advanced → **Developer mode** on → Create → paste `$ORIGIN/mcp`, authentication **OAuth** |
| Claude Code | `claude mcp add --transport http shareout $ORIGIN/mcp` then `/mcp` to sign in |

A ShareOut sign-in opens, then a consent screen ("Claude wants to publish pages to
your ShareOut account"). Allow, and the app is connected.

## Tools

| Tool | Does |
| --- | --- |
| `whoami` | Connected account + workspaces |
| `list_workspaces` | Workspaces and their ids |
| `list_artifacts` | Pages the person can see (`workspace_id`, `search`, `limit`) |
| `get_artifact` | One page; `include_content: true` adds the source |
| `publish_artifact` | New page from `content` (HTML or Markdown), `title`, optional `workspace_id`, `visibility` (`workspace` default, `private`, `public`) |
| `update_artifact` | Replace a page's content (same link, new version) |
| `invite_members` | Owners/admins: invite `emails` (list or comma/newline text) as `member`/`admin`; per-email result + join link |
| `list_members` | People in a workspace + pending invites (admins) |
| `resend_invite` / `revoke_invite` | Admins: resend or cancel a pending invite by `email` |
| `knowledge_search` | Cited passages from the workspace's learned Files and pages (`query`, optional `workspace_id`, `limit`) |
| `knowledge_entity` | One company, person or project by `name` (or entity id): its connections, sources and quoted mentions |
| `knowledge_facts` | Facts about `about` (amounts, dates, statuses), each with the quoted sentence and its source; optional `filter` |
| `knowledge_status` | Whether Knowledge is on, what's learned / processing / unreadable, and how many entities it knows |
| `get_help` | Short how-to and links |
| `report_problem` | Opens a support ticket for the ShareOut team |
| `search` / `fetch` | Read-only, ChatGPT deep-research shape |

Rules the tools follow:

- **Workspace default** — the person's only workspace; with several, the tool asks which.
  With none, pages are private in their personal space.
- **Never overwrites by name** — `publish_artifact` always creates a new page; changing an
  existing one is `update_artifact`.
- **Plain results** — each result says the link, who can see it, and any notice
  (visibility downgraded, under review, approval needed) to relay to the person.
- **Knowledge answers cite their sources** — the `knowledge_*` tools tell the model to answer
  in the person's language, only from what they return, naming the page or File (and link)
  behind each fact. They are read-only, workspace-scoped by the signed-in account, run the
  same `/v1/workspaces/{id}/knowledge/*` routes (so a source someone can't open never shows
  up), and searches are metered to the workspace like any other. When Knowledge is off they
  say so instead of failing. See [team/knowledge.md](../team/knowledge.md).
- **Same rules as the API** — the tools run the same handlers as `POST /v1/publish`,
  `GET /v1/artifacts`, `/v1/workspaces/{id}/members/invite`, so quotas, moderation,
  workspace publish policy and roles all apply.

## Protocol details (for client builders)

- Transport: Streamable HTTP, **stateless**, JSON responses only. `POST /mcp`; `GET` → 405.
  Supports the `initialize` handshake (2025-03-26 … 2025-11-25) and the stateless
  2026-07-28 revision (`server/discover`, per-request `_meta`).
- Auth: OAuth 2.1. Unauthenticated calls get `401` with
  `WWW-Authenticate: Bearer resource_metadata="$ORIGIN/.well-known/oauth-protected-resource/mcp"`.
- Discovery: `/.well-known/oauth-protected-resource[/mcp]` (RFC 9728),
  `/.well-known/oauth-authorization-server` (RFC 8414).
- Endpoints: `/oauth/register` (RFC 7591 DCR), `/oauth/authorize`, `/oauth/token`,
  `/oauth/revoke` (RFC 7009).
- PKCE `S256` and `state` are required. Redirect URIs must be `https`, or `http` on
  `localhost` / `127.0.0.1` (any port).
- Access tokens last 1 hour; refresh tokens rotate on every use (90-day sliding life).
  An access token is an ordinary personal `so_` token, so it also works on the REST API.
- A personal API token (`Authorization: Bearer so_…`) also works on `/mcp` for clients
  that take a static header. Workspace agent tokens (`sot_`) do not.

## Disconnect

Remove the connector in the AI app. Its tokens stop working when they expire (≤ 1 hour)
or immediately if the app revokes them. Regenerating your API token in ShareOut also
ends every connection's current access token.
