# SDK: MCP connections (the viewer's own accounts)

`sdk.mcp` lets a page call a **workspace MCP connection with the viewer's own account**
(Notion, Linear, Sentry, any remote MCP server). Each member sees their own data.

## When it applies

- Only **members-only workspace pages** (`visibility: "workspace"` or `"private"`, in a
  workspace). Publishing a public page with MCP is refused (`MCP_REQUIRES_MEMBERS_ONLY`).
- Only connections a workspace admin added as **MCP server** (Connections → MCP server, or
  `POST /v1/workspaces/{id}/mcp-connections {name, serverUrl}`). Reference them by name.
- Only tools the server marks **read-only**. Writes are not available from pages yet.

## Declare at publish

List each connection and the exact tools the page calls. Never an empty list.

```json
{ "capabilities": { "mcp": { "connections": [{ "name": "notion", "tools": ["search", "fetch"] }] } } }
```

MCP `publish_artifact` takes the same list as `mcp_connections: [{ name, tools }]`.
Omitting `capabilities` on a republish keeps the current declaration; `"mcp": null` clears it.

Don't guess tool names or arguments. Ask the user, or have a member who connected the
server call `POST /v1/workspaces/{id}/connections/{connId}/mcp/tools`, which lists the
server's tools with their input schemas.

## Call from the page

```javascript
const sdk = await ShareOut.create();
const res = await sdk.mcp.callTool('notion', 'search', { query: 'Roadmap' });
render(res.payload); // structuredContent, else first text block parsed as JSON, else the text
```

Keep a section current: `sdk.mcp.watchTool(conn, tool, input, handler, { refetchInterval })`
(30 s floor, pauses while hidden; handler gets `{type:'data', result, fetchedAt}` or
`{type:'error', error}`). Returns an unsubscribe function.

## Errors: branch on `err.code` (required)

Every page using `sdk.mcp` must render these states, per section, not one generic banner:

| `code` | Render |
|---|---|
| `approval_required`, `credentials_required`, `needs_reauth` | A button ("Use my Notion account" / "Reconnect Notion") whose click calls `await sdk.mcp.requestAccess('notion')`, then reloads that section if `allowed` |
| `server_unavailable`, `rate_limited` (`err.retryable`) | Keep last data, show "Couldn't refresh", retry once later |
| `tool_error` | The tool's message (`err.result?.payload`) in that section |
| `not_in_manifest`, `not_read_only` | Author bug: fix the declaration or tool |
| `mcp_not_available`, `not_allowed` | Hide the section (not a members-only view) |

`requestAccess` opens ShareOut's own dialog outside the page. Call it **only from a click**.
"Not now" is final until reload; don't loop.

Never put a viewer's results into `sdk.json`, tables or datasets: those are shared with
everyone who opens the page.

See also: [connections.md](connections.md) (owner-shared credentials),
[../team/workspace-connections.md](../team/workspace-connections.md).
