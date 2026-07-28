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
}
```

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
the real-time channel as a `comment:reaction` event.

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

**Auth:** session required. Permitted callers: comment author, artifact owner, or current assignee.

**Errors:** `400 ASSIGNEE_NOT_FOUND` — email is not a workspace member or collaborator.

**Filter by assignee:**

```http
GET /v1/data/{artifactId}/comments?assignee=me
GET /v1/data/{artifactId}/comments?assignee=alice@example.com
```

**Resolve:** the assignee (in addition to author/owner) may resolve the comment.

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
  mentions?: string[];
  authorType?: 'human' | 'agent';
  reactions?: Record<string, { count: number; mine: boolean }>;
  assigneeUserId?: string | null;
  assigneeEmail?: string | null;
  dueAt?: string | null;
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

- [REST API: Comments](../api/overview.md) - REST endpoints
