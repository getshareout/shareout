---
title: MCP connections
description: Let a members-only page read each viewer's own account on a remote MCP server.
---

import { Aside } from '@astrojs/starlight/components';

A page can call **the viewer's own account** on a remote MCP server (Notion, Linear,
Sentry, …). Every member who opens the page sees their own data, through their own
sign-in. ShareOut never shows the page anyone's token.

<Aside type="note" title="Members-only pages">
MCP connections work only on workspace pages with visibility `workspace` or `private`,
for internal members of that workspace. Public links, password links and guests never
reach them.
</Aside>

## 1. An admin adds the server

In the workspace **Connections** page choose **MCP server**, give it a name and the
server's `https` URL. ShareOut discovers how the server signs people in and registers
itself (a Client ID Metadata Document when the server supports it, otherwise dynamic
client registration).

```http
POST /v1/workspaces/{workspaceId}/mcp-connections
{ "name": "notion", "serverUrl": "https://mcp.notion.com/mcp" }
```

## 2. Each member connects their own account

Members click **Connect my account** on that server, or connect from the page itself
when it asks. Tokens are stored per member and refreshed automatically.

## 3. The page declares what it uses

Publish with the connection names and the **exact tools** the page calls. Only tools
the server marks read-only can be called from a page. An empty tool list is refused:
it never means "all tools".

```json
{
  "capabilities": {
    "mcp": { "connections": [{ "name": "notion", "tools": ["search", "fetch"] }] }
  }
}
```

Omit `capabilities` on a later publish to keep the current declaration; send
`"mcp": null` to remove it. Editor saves keep it. A changed declaration asks every
viewer to allow the page again.

## 4. Call it from the page

```javascript
const sdk = await ShareOut.create();

async function load() {
  try {
    const res = await sdk.mcp.callTool('notion', 'search', { query: 'Roadmap' });
    render(res.payload);
  } catch (err) {
    if (err.code === 'approval_required' || err.code === 'credentials_required') {
      showButton('Use my Notion account', async () => {
        const access = await sdk.mcp.requestAccess('notion');
        if (access.allowed) load();
      });
    } else if (err.code === 'needs_reauth') {
      showButton('Reconnect Notion', () => sdk.mcp.requestAccess('notion').then(load));
    } else if (err.retryable) {
      showRetry(load);
    } else {
      showMessage(err.message);
    }
  }
}
load();
```

`requestAccess` opens ShareOut's own dialog outside the page: the viewer connects
their account if needed and allows the page. **Not now** is final until the page is
reloaded, so call it from a button the viewer clicked.

### Keep data current

```javascript
const stop = sdk.mcp.watchTool('notion', 'search', { query: 'Roadmap' }, (event) => {
  if (event.type === 'data') render(event.result.payload, event.fetchedAt);
  else showSectionError(event.error);
}, { refetchInterval: 60_000 });
```

Polls at most every 30 seconds, pauses while the tab is hidden, and stops on errors
only the viewer can fix (`approval_required`, `credentials_required`, `needs_reauth`).

## Methods

```typescript
sdk.mcp.listConnections(): Promise<McpConnectionState[]>
sdk.mcp.callTool(connection: string, tool: string, input?: object): Promise<McpToolResult>
sdk.mcp.requestAccess(connection: string): Promise<{ allowed: boolean; connected: boolean; code?: string | null }>
sdk.mcp.watchTool(connection, tool, input, handler, { refetchInterval? }): () => void
```

`McpToolResult` has the tool's `content` blocks, `structuredContent` when the server
sends it, and `payload`: `structuredContent`, else the first text block parsed as JSON,
else that text.

## Error codes

Failures reject with `McpError` (`code`, `message`, `connection`, `retryable`).
Branch on `code`; don't collapse them into one banner.

| Code | Meaning | What the page should do |
|---|---|---|
| `approval_required` | The viewer hasn't allowed this page | Button → `requestAccess` |
| `credentials_required` | The viewer hasn't connected their account | Button → `requestAccess` |
| `needs_reauth` | Their sign-in expired or was revoked | Button → `requestAccess` |
| `not_in_manifest` | Connection or tool not declared at publish | Fix the declaration |
| `not_read_only` | Tool isn't marked read-only by the server | Use a read-only tool |
| `server_not_connected` | No such connection in the workspace | Ask an admin to add it |
| `tool_error` | The tool ran and reported failure (`err.result`) | Show its message |
| `server_unavailable` | The server didn't answer (`retryable`) | Retry once, later |
| `rate_limited` | Too many calls from this page (`retryable`) | Back off |
| `mcp_not_available` | Not a members-only page, or connectors are off | Hide the section |
| `not_allowed` | The viewer isn't an internal member | Hide the section |

## How it is kept safe

- The page never sees a token. Calls go through ShareOut with a 5-minute token bound
  to the page, the viewer and the declaration.
- Only the ShareOut page around the frame can mint that token or record consent; page
  code can't.
- Pages that declare MCP connections may only fetch, embed or load images from their
  own origin and ShareOut, and can't open popups.
- Viewers allow each page per connection. The workspace audit log records allow and
  revoke.
- Whoever builds a page controls the code that displays the results, which is why this
  is limited to members-only pages inside one workspace.
