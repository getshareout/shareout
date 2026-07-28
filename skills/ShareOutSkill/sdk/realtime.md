# SDK: Real-time (Tier 3)

Y.js-powered collaboration with presence. Access via `sdk.realtime(docId)`.

## Connection

```typescript
connect(): Promise<void>
disconnect(): void
destroy(): void
```

## Shared Types

```typescript
// Collaborative text
text(name: string): Y.Text

// Collaborative array
array<T>(name: string): Y.Array<T>

// Collaborative map
map<T>(name: string): Y.Map<T>

// XML fragment
xml(name: string): Y.XmlFragment
```

## Transactions

```typescript
transact(fn: () => void, origin?: unknown): void
```

## Presence

```typescript
presence.set(state: PresenceState): void
presence.get(): Map<string, PresenceState>
presence.subscribe(handler: (users: Map<string, PresenceState>) => void): () => void
```

## Events

```typescript
on(event: 'update' | 'status' | 'sync', handler: Function): void
off(event: 'update' | 'status' | 'sync', handler: Function): void
```

Status values: `'connecting'`, `'connected'`, `'disconnected'`

## Undo/Redo

```typescript
undoManager(scope: Y.AbstractType[]): Y.UndoManager
```

## Low-level Access

```typescript
ydoc: Y.Doc                              // Direct Yjs document
toJSON(): unknown                        // Serialize document
getStateVector(): Uint8Array             // For custom sync
getUpdate(stateVector?: Uint8Array): Uint8Array
```

## Examples

```javascript
const doc = sdk.realtime('workspace');
await doc.connect();

// Shared text
const text = doc.text('content');
text.insert(0, 'Hello');
text.observe(event => console.log(text.toString()));

// Shared array
const list = doc.array('items');
list.push([{ id: 1, name: 'Item' }]);
list.observe(() => renderList(list.toArray()));

// Shared map
const data = doc.map('metadata');
data.set('title', 'My Document');
data.observe(() => updateTitle(data.get('title')));

// Presence
doc.presence.set({
  user: { name: 'Alice', color: '#ff0000' },
  cursor: { x: 100, y: 200 }
});

doc.presence.subscribe(users => {
  for (const [clientId, state] of users) {
    renderCursor(clientId, state.cursor);
  }
});

// Atomic changes
doc.transact(() => {
  list.push(['a']);
  list.push(['b']);
  list.push(['c']);
});

// Undo/redo
const undoMgr = doc.undoManager([text]);
undoMgr.undo();
undoMgr.redo();

// Cleanup
doc.disconnect();
```

## Manifest Declaration

Declare each realtime doc id in your manifest (see [overview.md](overview.md#manifest-declaration)):

```json
"realtime": ["workspace", "cursors"]
```

## Related

- [Tables](table.md) - For structured non-collaborative data
- [Modules: Slides](../modules/slides/data-model.md) - Y.js in presentations
