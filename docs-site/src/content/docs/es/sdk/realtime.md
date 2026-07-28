---
title: Realtime (Nivel 3)
description: Colaboración potenciada por Y.js con presencia.
---

Colaboración en vivo, multijugador, potenciada por [Y.js](https://docs.yjs.dev) — texto,
arrays y maps compartidos, más presencia (cursores, quién está acá). Accedé vía
`sdk.realtime(docId)`.

## Conectar

```javascript
const doc = sdk.realtime('workspace');
await doc.connect();
```

## Tipos compartidos

```javascript
const text = doc.text('content');     // collaborative text
const list = doc.array('items');      // collaborative array
const meta = doc.map('metadata');     // collaborative map

text.insert(0, 'Hello');
text.observe(() => render(text.toString()));

list.push([{ id: 1, name: 'Item' }]);
list.observe(() => render(list.toArray()));
```

## Presencia

```javascript
doc.presence.set({ user: { name: 'Alice', color: '#2161FF' }, cursor: { x: 100, y: 200 } });

doc.presence.subscribe(users => {
  for (const [clientId, state] of users) renderCursor(clientId, state.cursor);
});
```

## Transacciones y deshacer

```javascript
doc.transact(() => { list.push(['a']); list.push(['b']); });

const undo = doc.undoManager([text]);
undo.undo();
undo.redo();
```

## Eventos

`on('status' | 'sync' | 'update', handler)` — el status es `connecting`,
`connected` o `disconnected`. Limpiá con `doc.disconnect()`.

## Manifest

```html
<script type="shareout/manifest">
{ "version": "2.0", "sources": { "realtime": ["workspace", "cursors"] } }
</script>
```

Para datos estructurados pero no colaborativos, usá [tables](/es/sdk/tables/) en su lugar.
