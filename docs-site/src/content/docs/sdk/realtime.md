---
title: Realtime (Tier 3)
description: Y.js-powered collaboration with presence.
---

Live, multiplayer collaboration powered by [Y.js](https://docs.yjs.dev) — shared
text, arrays, and maps, plus presence (cursors, who's here). Access via
`sdk.realtime(docId)`.

## Connect

```javascript
const doc = sdk.realtime('workspace');
await doc.connect();
```

## Shared types

```javascript
const text = doc.text('content');     // collaborative text
const list = doc.array('items');      // collaborative array
const meta = doc.map('metadata');     // collaborative map

text.insert(0, 'Hello');
text.observe(() => render(text.toString()));

list.push([{ id: 1, name: 'Item' }]);
list.observe(() => render(list.toArray()));
```

## Presence

```javascript
doc.presence.set({ user: { name: 'Alice', color: '#2161FF' }, cursor: { x: 100, y: 200 } });

doc.presence.subscribe(users => {
  for (const [clientId, state] of users) renderCursor(clientId, state.cursor);
});
```

## Transactions & undo

```javascript
doc.transact(() => { list.push(['a']); list.push(['b']); });

const undo = doc.undoManager([text]);
undo.undo();
undo.redo();
```

## Events

`on('status' | 'sync' | 'update', handler)` — status is `connecting`,
`connected`, or `disconnected`. Clean up with `doc.disconnect()`.

## Manifest

```html
<script type="shareout/manifest">
{ "version": "2.0", "sources": { "realtime": ["workspace", "cursors"] } }
</script>
```

For structured but non-collaborative data, use [tables](/sdk/tables/) instead.
