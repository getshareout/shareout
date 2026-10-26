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
| `list_artifacts` | The person's pages across all their workspaces + personal space; `workspace_id` (id or slug) narrows to one; `search`, `limit` (1–50) |
| `get_artifact` | One page. `include_content: true` adds the main file's source (`content`, `truncated`, `size_bytes`, and `other_files` when the page has more); `include_files: true` adds every file, main file first (`path`, `mime`, `size_bytes`, `encoding`, `content`, `truncated`; binary as base64). Up to 512 KB of file content per answer, the `get_version_source` limit: a file that doesn't fit comes back cut or without `content`, marked `truncated`. Files come from the newest saved version, returned as `version` (pass it to `update_artifact` as `base_version`). The result names the live version's change note (`live_message`) and, for a multi-page site, links every page (`?page=`) |
| `publish_artifact` | New page from `content` (HTML or Markdown) — or a multi-page site from `files` (see below) — `title`, optional `workspace_id`, `visibility` (`workspace` default, `private`, `public`), `folder` (name or id of a folder in that workspace), `message` (history note). For a site the result links every page (`?page=`) |
| `update_artifact` | Replace a page's content, or with `files` a site's whole file set (same link, new version, returned as `version`). `base_version` (the `version` `get_artifact` returned) makes it refuse the write if a newer version was saved since; a write that would remove files is refused unless `replace_all_files: true` (see **No silent loss** below). Optional `title` renames it, `folder` (name or id) moves it into a folder of its workspace, `message` is the change note (omit it and one is written automatically) |
| `list_versions` | A page's history, newest first: who, when, how (`api`/`agent`/`editor`/`restore`), change note, comment count, approvals, which one is live. Viewer+ |
| `get_version_source` | One version's main file (`artifact_id`, `version_no`), up to 512 KB. Viewer+ |
| `restore_version` | Brings `version_no` back as a **new** version (history kept), optional `message`. Editor+ |
| `list_comments` | Comment threads with ids, resolved state, assignee and the version each was written on; `open_only` skips resolved |
| `resolve_comment` / `assign_comment` | Resolve or reopen (`resolved: false`) a thread; assign it to someone on the page by email (`assignee: null` clears). Anyone with comment access |
| `approve_version` | Approve the live version (or `version_no`); `approved: false` withdraws. A record, not a publish gate. Comment access |
| `list_jobs` | Scheduled sends; with `artifact_id` the page's schedules (owner/editors see shared ones plus their own personal deliveries, never someone else's DM subscription), else the person's own (`workspace_id` narrows) |
| `folder_access` | Who can see a folder (`folder` name or id): the real audience (the most open of the folder's own or inherited visibility and the pages and files inside, which keep their own), how many items are more open than the folder, and every outside grant, with grant ids. Admins and the folder's creator also get those items by name. Internal members only |
| `folder_activity` | What outside people opened in a folder's subtree (newest 100). Admins and the folder's creator |
| `share_with_person` | Share a `folder` (or `file_id`) with one outside `email`: `capability` `view`/`comment`, optional `expires_in_days` or `expires_at`; returns the `/shared?folder=` portal link and the grant id. Admins and the folder's creator, when the workspace has external sharing |
| `revoke_share` | Remove a grant by `grant_id` (from `folder_access`). Admins and the folder's creator, even with external sharing off |
| `set_guest_comments` | Let people with no account comment (after an email code) where they can already open the page: `artifact_id` (owner only; `enabled: null` follows the folder) or `folder` (admins and the folder's creator), `enabled` true/false |
| `invite_members` | Owners/admins: invite `emails` (list or comma/newline text) as `member`/`admin`; per-email result + join link |
| `list_members` | People in a workspace + pending invites (admins) |
| `resend_invite` / `revoke_invite` | Admins: resend or cancel a pending invite by `email` |
| `knowledge_search` | Cited passages from the workspace's learned Files and pages (`query`, optional `workspace_id`, `limit`) |
| `knowledge_entity` | One company, person or project by `name` (or entity id): its connections, sources and quoted mentions |
| `knowledge_facts` | Facts about `about` (amounts, dates, statuses), each with the quoted sentence and its source; optional `filter` |
| `knowledge_status` | Whether Knowledge is on, what's learned / processing / unreadable, and how many entities it knows |
| `knowledge_get` | One note by `path`, with its body and the pages it was learned from (`source_artifacts`: title + absolute `url` when the person may open it, `available: false` otherwise) |
| `knowledge_from_artifact` | Notes learned from one page (`artifact_id`; the page's workspace by default) — the reverse of a note's sources; empty when the person can't open the page |
| `list_connections` | The workspace's data connectors; `queryable` (SQL) / `files` (S3) only when an admin switched AI on for that connector |
| `query_connection` | One read-only `SELECT` on a warehouse connector (Snowflake, BigQuery, Redshift, Aurora, Supabase); `connection`, `sql`, optional `project_id` (BigQuery); ≤ 1000 rows |
| `browse_storage` | Amazon S3 connector: `action: "list"` (+ `prefix`) or `"read"` (+ `key`); CSV → rows, JSON → data, text → text |
| `get_help` | Short how-to and links |
| `report_problem` | Opens a support ticket for the ShareOut team |
| `search` / `fetch` | Read-only, ChatGPT deep-research shape. `search` covers all the person's workspaces unless `workspace_id` (id or slug) narrows it; `fetch` is by id |

Rules the tools follow:

- **Workspace default** — tools that act on one workspace (`publish_artifact`, `knowledge_*`,
  member tools, connector tools) use the person's only workspace; with several, they ask which. With none,
  pages are private in their personal space. Lookups (`list_artifacts`, `search`) cover every
  workspace unless `workspace_id` narrows them; `get_artifact`, `fetch` and `update_artifact`
  go by page id.
- **Arguments are checked** — a value outside a tool's input schema (an unknown `visibility`,
  a non-number `limit`, a missing required field) returns an error result and nothing is done;
  it is never replaced by a default. A `workspace_id` the person doesn't belong to gets the same
  "not a member of that workspace" error from every tool.
- **Folders** — `folder` takes a folder's name (case-insensitive) or id in the page's workspace.
  An unknown name, or one shared by several folders, is refused with the ids to pick from.
  Personal pages have no folders. There is no folder listing or delete tool; do those in ShareOut.
- **Page and sharing tools reuse the REST gates** — `get_artifact`'s `include_content` /
  `include_files` read with the viewer gate of `GET /v1/artifacts/{id}/files` (owner or a
  viewer/editor collaborator); `list_versions` / `get_version_source` /
  `restore_version` run the `/v1/artifacts/{id}/versions*` handlers (viewer / editor);
  `list_comments`, `resolve_comment`, `assign_comment` and `approve_version` run the same
  comment-access checks as the Home review endpoints; `list_jobs` runs `GET /v1/jobs`;
  `set_guest_comments` runs `PUT /v1/data/{id}/comments/_config` (owner) or the folder's
  guest-comments switch (folder manager);
  `folder_activity`, `share_with_person` and `revoke_share` run the
  `/v1/workspaces/{id}/folders/{id}/activity`, `/share-person` and `/grants/{id}` handlers
  (admin, or the folder's manager). A refusal comes back as an error result and nothing changes.
- **Multi-page sites (`files`)** — instead of `content`, send
  `files: [{ path, content, encoding? }]`: `index.html` is the first page, other pages and
  assets (css, js, json, md, svg, images, fonts) sit beside it and link with relative hrefs
  ([core/html-spec/pages.md](../core/html-spec/pages.md#multiple-html-files-sites)).
  `encoding: "base64"` for binary files. Paths must be relative: no `..`, no leading `/`, no
  backslash, no empty segments (`a//b`) and no control characters. HTML pages (`.html`/`.htm`,
  which become `?page=` links) use letters, digits, spaces and `. _ - ~ /` only
  (`guides/setup.html`); other assets may also use what REST accepts, e.g. `img/logo@2x.png`,
  `a+b.css`, `x,y=(1).css`. The mime comes from the extension. It runs the same `/v1/publish` path as REST, so its rules apply unchanged: an
  allowed mime per file, no duplicate paths, `index.html` present when there is more than one
  file, 100 MB per file, 500 MB per publish, the instance storage quota
  (`STORAGE_QUOTA_BYTES`), the daily publish limit and moderation. On `update_artifact`, `files`
  is the complete set: every page and asset, changed or not. Send `content` or `files`, not both.
- **No silent loss** — `get_artifact` marks every file it could not return whole
  (`truncated`), and `update_artifact` refuses writes that would lose work, with nothing saved:
  - a write that would remove files of the newest version — `content` alone on a page that
    has more files, or `files` that leave some out — fails with `WOULD_REMOVE_FILES` and the
    list (`would_remove`), unless `replace_all_files: true` says the person wants them gone.
    `content` on a one-file page still replaces it, even in the other format;
  - with `base_version`, a write fails with `VERSION_CONFLICT` when a newer version was
    saved after that read. Read the page again and redo the change on what comes back.

  To change a site: `get_artifact` with `include_files: true`, edit, send every file back as
  `files` with `base_version`. Never send a `truncated` file back. A site that doesn't fit in
  one answer can't be changed from the connector without losing files: edit it in ShareOut,
  or read `GET /v1/artifacts/{id}/files` and publish every file with `POST /v1/publish`.
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
