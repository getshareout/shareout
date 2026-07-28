---
title: Comments
description: Threaded comments on pages and files — REST API, SDK, viewer overlay, and access rules for self-hosted ShareOut.
---

import { Aside } from '@astrojs/starlight/components';

Threaded comments are a first-class collaboration surface: humans and agents leave notes
on **pages** and **files**, assign action items, pin spots on a page, and get notified on
@mentions and replies.

Access from page code via `sdk.comments`, or call the data API directly.

## Two surfaces, one store

| Surface | Where it lives | Scoping |
| --- | --- | --- |
| **Page / artifact** | The page's own `artifact_id` | Optional `contextId` for sections/pins |
| **File (deliverable)** | The workspace **asset-bucket** artifact | **Required** `contextId`: `file:<deliverableId>` |

All rows live in D1 table `artifact_comments`. Feature flag: `collab.comments`.

<Aside type="caution" title="File comments are not a free-for-all">
On an asset-bucket artifact you **must** pass `contextId=file:…`. Listing without a file
context returns `400 FILE_CONTEXT_REQUIRED`. Access is checked per file (workspace
visibility, ownership, or an external grant) — not via the page's `identityMode`.
Realtime WebSockets are **disabled** on buckets so the stream cannot bypass that gate.
</Aside>

## Response envelope

Every data-API call returns a consistent JSON envelope:

```json
// Success
{ "success": true, "data": { /* payload */ } }

// Error
{ "success": false, "error": "Human-readable message", "code": "ERROR_CODE" }
```

When listing comments, read **`response.data.comments`** (not top-level `comments`).

## REST API

Base path: `/v1/data/{artifactId}/comments`

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/` | List. Query: `contextId`, `parentId` (`null` for roots), `resolved`, `assignee`, `limit`, `skip` |
| `POST` | `/` | Create. Body: `content` (required), `contextId`, `parentId`, `authorName`, `position`, `state`, `mentions[]`, `assignee`, `dueAt` |
| `GET` | `/{id}` | Single comment (+ reactions) |
| `PATCH` | `/{id}` | Edit content (author or artifact owner) |
| `DELETE` | `/{id}` | Delete (author or artifact owner) |
| `GET` | `/{id}/replies` | Direct replies |
| `PATCH` | `/{id}/resolve` | `{ "resolved": true \| false }` — author, owner, or assignee |
| `PATCH` | `/{id}/assign` | `{ "assignee": "email" \| null, "dueAt"?: string \| null }` — signed in |
| `POST` | `/{id}/reactions` | `{ "emoji": "👍" }` toggle — signed in |
| `GET` / `PUT` | `/_config` | Per-artifact config (PUT owner-only) |
| `GET` | `/_people` | Assignable people. Requires a session that is itself on the artifact (owner, workspace member, or collaborator) — a bare sign-in gets `403 FORBIDDEN` |
| `GET` | `/_unread` | Unread count for signed-in viewer |
| `POST` | `/_read` | Mark all read |
| `WS` | `/ws` | Realtime events (not available on file buckets) |

### Config (`/_config`)

```typescript
interface CommentsConfig {
  enabled: boolean;                          // default true
  identityMode: 'anonymous' | 'named' | 'authenticated';  // default 'anonymous'
  allowReplies: boolean;                     // default true
  maxDepth: number;                          // 1–10, default 3
  overlayEnabled?: boolean;                  // signed-in viewer toolbar; default true
}
```

| `identityMode` | Who can post |
| --- | --- |
| `anonymous` | Anyone; optional display name |
| `named` | Display name required if not signed in |
| `authenticated` | Session required |

### File comment examples

```http
# List comments on a file
GET /v1/data/{bucketArtifactId}/comments?contextId=file%3Adlv_abc123
Cookie: shareout_session=…

# Post on a file
POST /v1/data/{bucketArtifactId}/comments
Content-Type: application/json

{
  "content": "Please export as PDF as well.",
  "contextId": "file:dlv_abc123"
}
```

Who may read/post on a file:

- File **owner**
- Workspace **member** when the file is not `private`
- External **sharee** with a grant capability of `view` (read) or `comment` (post)

## SDK methods

```typescript
// CRUD
add(options: {
  content: string;
  contextId?: string;
  parentId?: string;
  authorName?: string;
  position?: CommentPosition;
  state?: unknown;
  mentions?: string[];
}): Promise<Comment>

reply(parentId: string, content: string, authorName?: string): Promise<Comment>
edit(id: string, content: string): Promise<Comment>
delete(id: string): Promise<boolean>
findById(id: string): Promise<Comment | null>
getReplies(parentId: string): Promise<Comment[]>
getThread(rootId: string): Promise<CommentThread>
react(id: string, emoji: string): Promise<ReactionResult>

// Configuration (owner only)
getConfig(): Promise<CommentsConfig>
setConfig(config: Partial<CommentsConfig>): Promise<CommentsConfig>

// Action items (session required)
resolve(id: string, resolved?: boolean): Promise<Comment>
assign(id: string, options?: { assignee?: string | null; dueAt?: string | null }): Promise<Comment>

// Real-time
subscribe(handler: (event: CommentEvent) => void): () => void
subscribeToContext(contextId: string, handler: (event: CommentEvent) => void): () => void
disconnect(): void

// State bridge (pinned comments)
onCaptureState(fn: () => unknown | Promise<unknown>): void
onRestoreState(fn: (state: unknown) => void | Promise<void>): void
```

## Query builder

```typescript
find(filter?: { contextId?: string; parentId?: string | null }): CommentsQuery

query.context(contextId: string): CommentsQuery
query.topLevel(): CommentsQuery
query.sort(field: 'createdAt' | 'updatedAt', order: 'asc' | 'desc'): CommentsQuery
query.limit(n: number): CommentsQuery
query.skip(n: number): CommentsQuery
query.exec(): Promise<Comment[]>
```

## Types

```typescript
interface Comment {
  id: string;
  contextId: string | null;
  parentId: string | null;
  authorId: string | null;
  authorName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  resolved?: boolean;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  position?: CommentPosition | null;
  state?: unknown | null;
  mentions?: string[];
  authorType?: 'human' | 'agent';
  reactions?: Record<string, { count: number; mine: boolean }>;
  assigneeUserId?: string | null;
  assigneeEmail?: string | null;
  dueAt?: string | null;
}

interface CommentEvent {
  type: 'comment:added' | 'comment:updated' | 'comment:deleted' | 'comment:resolved';
  comment: Comment;
}

interface CommentThread {
  comment: Comment;
  replies: CommentThread[];
}

interface CommentPosition {
  selector?: string;
  relX?: number;
  relY?: number;
  pctX?: number;
  pctY?: number;
  scrollY?: number;
}
```

## Examples

```javascript
// Configure (owner only)
await sdk.comments.setConfig({
  enabled: true,
  identityMode: 'named',
  allowReplies: true,
  maxDepth: 3,
  overlayEnabled: true,
});

// Add a comment pinned to a slide
const comment = await sdk.comments.add({
  content: 'Great chart!',
  contextId: 'slide-5',
  authorName: 'Alice',
});

// Reply
await sdk.comments.reply(comment.id, 'Thanks!', 'Bob');

// Query top-level comments for a context
const comments = await sdk.comments
  .find({ contextId: 'slide-5' })
  .topLevel()
  .sort('createdAt', 'desc')
  .limit(50)
  .exec();

// Full nested thread
const thread = await sdk.comments.getThread(comment.id);

// Real-time updates
const unsub = sdk.comments.subscribeToContext('slide-5', (event) => {
  if (event.type === 'comment:added') renderComment(event.comment);
});
// Later:
unsub();
```

## State bridge

Pinned comments can capture and restore app state (e.g. active filters on a dashboard).
Register callbacks before adding comments:

```javascript
sdk.comments.onCaptureState(() => ({
  filters: currentFilters,
  activeTab,
}));

sdk.comments.onRestoreState((state) => {
  currentFilters = state.filters;
  activeTab = state.activeTab;
});
```

When a comment is added, the current state is stored with it. Opening a pinned comment
replays the state via `onRestoreState`.

## Action items

Any comment can be turned into an action item by assigning it to a workspace member
or collaborator. The assignee gets an email (and a Telegram message if linked). When
they resolve the comment, the requester is notified and can reopen with one click.

**In the artifact viewer:** open the comment panel → **Assign** → pick a person and an
optional due date.

**Via API:**

```http
# Assign when creating
POST /v1/data/{artifactId}/comments
{ "content": "Fix the Y-axis label", "assignee": "alice@example.com", "dueAt": "2025-08-01T00:00:00Z" }

# Assign or unassign an existing comment
PATCH /v1/data/{artifactId}/comments/{id}/assign
{ "assignee": "alice@example.com", "dueAt": "2025-08-01T00:00:00Z" }

# Unassign
PATCH /v1/data/{artifactId}/comments/{id}/assign
{ "assignee": null }
```

The `assignee` must be in the artifact's people set (workspace members + collaborators);
unknown addresses return `400 ASSIGNEE_NOT_FOUND`.

**Tracking:** open action items across artifacts appear in the **Home notifications**
bell — sorted by due date, with **Done** / **Reopen**.

**Filter by assignee:**

```http
GET /v1/data/{artifactId}/comments?assignee=me
GET /v1/data/{artifactId}/comments?assignee=alice@example.com
```

**AI crew tools:** `comment_create`, `action_item_create`, `action_item_list`.

## Viewer toolbar (built-in UI)

When comments are enabled, the sandbox viewer injects a comments overlay according to
`identityMode`:

| `identityMode` | Who sees the panel |
| --- | --- |
| `anonymous` (default) | Anyone — optional display name |
| `named` | Anyone — display name required to post |
| `authenticated` | Signed-in only (guests see **Log in to comment**) |

| Feature | Notes |
| --- | --- |
| Unread badge | Signed-in only (counts comments since last read) |
| Open / Resolved filters | Switch thread views |
| Reactions / Assign | Signed-in only |
| Typing indicators | Via the comments WebSocket |
| Presence | Others currently on the comments channel |
| Pin to page | Places a numbered pin in the page iframe |
| Resolve | Signed-in author / owner / assignee |
| Deep link | `#comment-<id>` scrolls to a card |

Owners and collaborators can also manage threads from the **Comments** tab in the
[workspace Inspector](/everyone/your-workspace/#inspector-right-rail).

### File UIs

| Place | Behavior |
| --- | --- |
| **Home → Assets** | Modal thread on a deliverable (`file:<id>`) |
| **`/shared` portal** | External sharees with comment grant can read/post on shared files |

These UIs use the same REST API; they do not open a WebSocket.

## Notifications

| Trigger | Channel |
| --- | --- |
| @mention (emails in `mentions[]`) | Email (+ Telegram if linked) |
| Reply to your comment | Email (+ Telegram if linked) |
| Assigned action item | Email (+ Telegram if linked) |
| Action item resolved | Email to requester |

Only people already **on the artifact** — the owner, workspace members, and
collaborators, the same set `/_people` returns — are notifiable. `mentions[]` is
client input on a comment an anonymous visitor may be allowed to post, so an
address outside that set is stored and rendered but never mailed. Add someone as
a collaborator first if you want the mention to reach them.

## Error codes (common)

| Code | Status | Meaning |
| --- | --- | --- |
| `COMMENTS_DISABLED` | 403 | `_comments_config.enabled` is false |
| `AUTH_REQUIRED` | 401 | Signed-in identity required for this action |
| `NAME_REQUIRED` | 400 | `identityMode: named` without a display name |
| `FILE_CONTEXT_REQUIRED` | 400 | Bucket list/post without `file:…` context |
| `FILE_NOT_FOUND` | 404 | Context points at another bucket or missing file |
| `FORBIDDEN` | 403 | No access to the file / not author-or-owner |
| `ASSIGNEE_NOT_FOUND` | 400 | Assignee is not on this artifact's people set |
| `MAX_DEPTH` | 400 | Reply would exceed `maxDepth` |
| `REALTIME_UNAVAILABLE` | 403 | WebSocket requested on a file bucket |
| `CONTENT_TOO_LONG` | 400 | Body over 10 000 characters |

## Self-host notes

- Enable feature `collab.comments` (default on).
- Bind Durable Object `COMMENTS` (see `wrangler.toml`) for page realtime.
- Outbound mail for mentions/assigns needs [email](/self-host/email/) configured.
- The overlay is controlled by `enabled` **and** `overlayEnabled` in `_comments_config`
  (cached briefly in KV as `cmtcfg:{artifactId}`).

<Aside type="note" title="Real-time transport">
`subscribe` and `subscribeToContext` open a WebSocket with exponential-backoff reconnection
(up to 10 attempts). Call `disconnect()` to close explicitly. The connection is torn down
when all subscribers unsubscribe. File (bucket) comments never open this socket.

On **private** and **workspace** pages the socket requires a signed-in session. Public pages
allow anonymous subscribers (matching open page access).
</Aside>
