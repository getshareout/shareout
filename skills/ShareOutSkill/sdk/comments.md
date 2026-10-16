# SDK: Comments

Threaded comments with real-time updates. Access via `sdk.comments`.

## Configuration (Owner Only)

```typescript
getConfig(): Promise<CommentsConfig>
setConfig(config: Partial<CommentsConfig>): Promise<CommentsConfig>
```

```typescript
interface CommentsConfig {
  enabled: boolean;
  identityMode: 'anonymous' | 'named' | 'authenticated';
  allowReplies: boolean;
  maxDepth: number;
  /** Guests (no account) may comment after an email code. Unset = follow the folder. */
  guestComments?: boolean;
}
```

## Guest comments (no account)

Clients reviewing through a link can comment without creating an account. The owner turns
it on per artifact — `PUT /v1/data/{artifactId}/comments/_config` with
`{ "guestComments": true }` (`false` turns it off, `null` follows the folder) — or for a whole
folder: `PUT /v1/workspaces/{wid}/folders/{fid}/guest-comments` `{ "enabled": true }` (admins
and the folder's creator; `GET` reads it). An artifact without its own setting inherits the
nearest folder that has it on. `GET …/_config` also returns `guestCommentsEffective`.
MCP: `set_guest_comments`.

In the app: the folder's **Who has access** panel has an **Allow guest comments** switch
(folder managers only), and the artifact's **Comments** tab has **Follow folder / On / Off**
with the effective state (owner only). Point a human there when they ask where to turn it on.

Who can comment as a guest: only on artifacts they can already open without an account — a
**public** page, or a **password / credentials** page they unlocked (the access cookie is the
proof). Private and workspace pages stay account-only.

Flow (the viewer toolbar shows it as **Comment as guest**: name, email, code):

| Method | Path (`/v1/data/{artifactId}/comments`) | Body / result |
|---|---|---|
| `GET` | `/_guest` | `{ enabled, guest: { name } \| null }` — only your own name |
| `POST` | `/_guest/code` | `{ name, email }` → emails a 6-digit code (10 min) |
| `POST` | `/_guest/verify` | `{ name, email, code }` → sets `shareout_guest_{artifactId}` (HttpOnly, SameSite=Strict, 12 h) |
| `DELETE` | `/_guest` | Signs the guest out |

- The token is an HMAC over artifact id + name + a keyed email hash, **bound to one artifact**.
- Guest comments carry `authorType: "guest"`; the email is stored only as a keyed hash and is
  never returned — no reader (guest or member) can see a guest's address.
- Guests comment and reply. They cannot resolve, assign, react, approve or `@mention`
  (mentions are dropped), and `@AI` does nothing. The owner can delete any guest comment.
- With guests on, `named` and `authenticated` modes require the guest code from anyone
  without an account; `anonymous` keeps anonymous posting and names verified guests.
- Writes with the guest cookie must come from a page on this instance (`Origin` check) —
  `403` / `401` otherwise. Limits: 10 codes / hour per IP and 6 per address, 20 comments /
  hour per guest and 30 per IP (`429 RATE_LIMIT_EXCEEDED`).

| Code | Meaning |
|---|---|
| `401 GUEST_VERIFICATION_REQUIRED` | Guests are on but this request has no valid guest token for this artifact |
| `403 GUEST_COMMENTS_DISABLED` | Guests are off here, or the requester cannot open the page without an account |
| `400 INVALID_CODE` | Wrong, expired or used-up code (5 tries per code) |

## CRUD Methods

```typescript
// Add comment
add(options: {
  content: string;
  contextId?: string;
  parentId?: string;
  authorName?: string;
}): Promise<Comment>

// Reply to comment
reply(parentId: string, content: string, authorName?: string): Promise<Comment>

// Edit comment (author/owner only)
edit(id: string, content: string): Promise<Comment>

// Delete comment (author/owner only)
delete(id: string): Promise<boolean>

// Get single comment
findById(id: string): Promise<Comment | null>

// Get replies to comment
getReplies(parentId: string): Promise<Comment[]>

// Get full thread (nested)
getThread(rootId: string): Promise<CommentThread>

// Toggle an emoji reaction for the current user (sign-in required); returns the new summary
react(id: string, emoji: string): Promise<ReactionResult>
```

List, reply and single-comment responses include a `reactions` summary scoped to
the viewer: `{ "👍": { count: 2, mine: true } }`. Reaction changes broadcast over
the real-time channel as a `comment:reaction` event. Over REST, `POST /v1/data/{id}/comments/{commentId}/reactions {"emoji":"👍"}` accepts a session cookie or a Bearer API token (the token's user is the reactor; a token user is also the comment author on create).

## Query Builder

```typescript
find(filter?: { contextId?: string; parentId?: string | null }): CommentsQuery

// Chain methods
query.context(contextId: string): CommentsQuery
query.topLevel(): CommentsQuery
query.sort(field: 'createdAt' | 'updatedAt', order: 'asc' | 'desc'): CommentsQuery
query.limit(n: number): CommentsQuery
query.skip(n: number): CommentsQuery
query.exec(): Promise<Comment[]>
```

## Real-time Subscription

```typescript
// Subscribe to all comments
subscribe(handler: (event: CommentEvent) => void): () => void

// Subscribe to specific context
subscribeToContext(contextId: string, handler: (event: CommentEvent) => void): () => void

// Disconnect WebSocket
disconnect(): void
```

```typescript
interface CommentEvent {
  type: 'comment:added' | 'comment:updated' | 'comment:deleted' | 'comment:resolved';
  comment: Comment;
}

interface ReactionEvent {
  type: 'comment:reaction';
  commentId: string;
  reactions: Record<string, { count: number; mine: boolean }>;
}
```

The realtime channel also emits `presence` (`{ type: 'presence', count }`) and
`typing` (`{ type: 'typing', name }`) frames. The built-in comments overlay
consumes these for live presence ("N others here") and typing indicators.

**Viewer toolbar:** signed-in viewers with comment access see a **Comments** button in the artifact toolbar. It opens reactions (emoji), typing indicators, live presence, and resolve controls. Owners and editors also manage threads from the Home **Inspector → Comments** tab; unresolved threads on artifacts you can see surface in Home **Needs You**.

**Notifications:** when a comment @mentions someone or replies to another
person, that recipient is notified by email and (if linked) Telegram with a deep
link back to the conversation — including comments left by AI agents. Mentions
only reach people already on the artifact (owner, workspace members,
collaborators — what `/_people` returns); an address outside that set is stored
and rendered but never mailed.

## Action items

A comment can be assigned to a workspace member or collaborator, turning it into a tracked action item.

**Assign when posting:**

```javascript
const comment = await sdk.comments.add({
  content: 'Please update the revenue numbers.',
  assignee: 'alice@example.com', // workspace member or collaborator email
  dueAt: '2026-07-15T00:00:00Z', // optional ISO datetime
});
```

**Assign or reassign an existing comment:**

```http
PATCH /v1/data/{artifactId}/comments/{commentId}/assign
Authorization: Bearer {token}
Content-Type: application/json

{ "assignee": "alice@example.com", "dueAt": "2026-07-15T00:00:00Z" }
```

Clear the assignment by passing `"assignee": null` (also clears `dueAt`).

**Auth:** signed-in user (session cookie or Bearer API token). Permitted callers: comment author, artifact owner, current assignee, or anyone with **comment access** — an owner or collaborator (across linked accounts), an internal member of the artifact's workspace when it is workspace- or public-visible, or a `comment` grant. A view-only grant or a signed-in stranger on a public page does not qualify.

**Errors:** `400 ASSIGNEE_NOT_FOUND` — email is not a workspace member or collaborator.

**Filter by assignee:**

```http
GET /v1/data/{artifactId}/comments?assignee=me
GET /v1/data/{artifactId}/comments?assignee=alice@example.com
```

**Resolve / reopen:**

```http
PATCH /v1/data/{artifactId}/comments/{commentId}/resolve
Authorization: Bearer {token}
Content-Type: application/json

{ "resolved": true }
```

`"resolved": false` reopens. Same callers as assign. The response is the updated comment (`resolved`, `resolvedBy`, `resolvedAt`).

**Activity feed:** `GET /v1/home/activity-feed` response includes:
- `actionItems[]` — comments assigned to the signed-in user that are still open.
- `requestedOpen` — count of comments the user assigned to others that are still open.

**Done state** reuses `resolved: true`.

**Notifications:** the assignee is notified by email and Telegram on assignment; the requester is notified when the item is resolved.

**New `Comment` fields:**

| Field | Type | Description |
|---|---|---|
| `assigneeUserId` | `string \| null` | Internal user ID of the assignee |
| `assigneeEmail` | `string \| null` | Email of the assignee |
| `dueAt` | `string \| null` | ISO 8601 due datetime |

## Review mode

Home **Inspector → Comments** filters Open/All, resolves/reopens and assigns threads (anyone with comment access, as above). Each comment stores `versionId`, the version live when it was written (null on older comments), so a thread left on an older version shows "on vN". **History** shows each version's comment count and approvals.

Approve a version — a record shown in Details and History, not a publish gate:

```http
POST /v1/home/approvals
Authorization: Bearer {token}
Content-Type: application/json

{ "artifactId": "art_…", "versionId": "ver_…", "approved": true }
```

`versionId` defaults to the live version; `"approved": false` withdraws your approval. The artifact's owner hears about each new approval (feed, email, Telegram — once per approver per version, never for their own).

Followers (an `artifact` follow) and collaborators hear about new versions with each version's note (the author's, or the AI "what changed" line). Notices are debounced: an hourly sweep sends one per artifact once publishing has been quiet for 10 minutes, covering every version since the last notice. The publisher is never notified, nor anyone who can no longer open the page. Email follows the **product** email preference and its unsubscribe link; Telegram follows the same opt-out. `GET /v1/home/review?artifactId=…` returns `{live_version_id, live_version_no, can_review, approvals, my_approvals}`. Needs comment access (`403 FORBIDDEN` otherwise). The MCP connector exposes the same actions ([integrations/mcp-connector.md](../integrations/mcp-connector.md)).

## Ask the AI from a comment

A comment containing `@AI` (or `@IA` / `@ShareOut`) by the artifact's owner or an editor
runs the page editor: it publishes a new version and replies in the same thread with
what changed. Others get a reply saying edit access is needed. Counts against the daily
publish limit and storage quota. Not for file comments.

## Examples

```javascript
// Configure (artifact owner)
await sdk.comments.setConfig({
  enabled: true,
  identityMode: 'named',
  allowReplies: true,
  maxDepth: 3
});

// Add comment to a slide
const comment = await sdk.comments.add({
  content: 'Great presentation!',
  contextId: 'slide-5',
  authorName: 'Alice'
});

// Reply
await sdk.comments.reply(comment.id, 'Thanks!', 'Bob');

// Query comments for a slide
const comments = await sdk.comments
  .find({ contextId: 'slide-5' })
  .topLevel()
  .sort('createdAt', 'desc')
  .limit(50)
  .exec();

// Get full thread
const thread = await sdk.comments.getThread(comment.id);

// Real-time updates
const unsub = sdk.comments.subscribeToContext('slide-5', (event) => {
  if (event.type === 'comment:added') {
    renderComment(event.comment);
  }
});

// Later
unsub();
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
  mentions?: string[];
  authorType?: 'human' | 'agent' | 'guest';
  reactions?: Record<string, { count: number; mine: boolean }>;
  assigneeUserId?: string | null;
  assigneeEmail?: string | null;
  dueAt?: string | null;
  versionId?: string | null;
}

interface ReactionResult {
  commentId: string;
  emoji: string;
  reacted: boolean;
  reactions: Record<string, { count: number; mine: boolean }>;
}

interface CommentThread {
  comment: Comment;
  replies: CommentThread[];
}
```

## Related

- [REST API overview](../api/overview.md) — auth and base URLs; the comment routes above are `/v1/data/{artifactId}/comments/*`
