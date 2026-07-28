---
title: JSON store (Nivel 1)
description: Almacenamiento clave-valor para estado simple del artifact.
---

Almacenamiento clave-valor para estado simple — preferencias, flags, valores cacheados.
Accedé vía `sdk.json`.

## Métodos

```typescript
get<T>(key: string): Promise<T | null>
set<T>(key: string, value: T): Promise<void>
update<T>(key: string, fn: (prev: T | null) => T): Promise<T>
delete(key: string): Promise<boolean>
exists(key: string): Promise<boolean>
list(): Promise<string[]>
clear(): Promise<void>
```

## Atomicidad

`update()` reintenta con compare-and-swap (`If-Match` / `If-None-Match`) ante escrituras concurrentes.

## Ejemplos

```javascript
await sdk.json.set('prefs', { theme: 'dark', fontSize: 14 });
const prefs = await sdk.json.get('prefs');

// Atomic increment
const next = await sdk.json.update('counter', n => (n || 0) + 1);

const keys = await sdk.json.list();
```

## Manifest

Declará cada key que uses:

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "json": {
      "prefs": { "default": { "theme": "light" } },
      "counter": { "default": 0 }
    }
  }
}
</script>
```

Recurrí a [tables](/es/sdk/tables/) cuando necesites muchos registros estructurados con
filtrado en lugar de un único valor.
