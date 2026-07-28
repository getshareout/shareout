---
title: Tables (Nivel 2)
description: Registros estructurados con filtrado, ordenamiento y paginación.
---

import { Aside } from '@astrojs/starlight/components';

Registros estructurados — tareas, leads, entradas — con un query builder. Accedé vía
`sdk.table(name)`.

## Métodos

```typescript
insert(doc): Promise<T>
insertMany(docs): Promise<T[]>
findById(id): Promise<T | null>
findOne(filter): Promise<T | null>
find(filter?): Query<T>          // chainable
updateById(id, changes): Promise<T | null>
update(filter, changes): Promise<{ updated: number }>
deleteById(id): Promise<boolean>
delete(filter): Promise<{ deleted: number }>
count(filter?): Promise<number>
distinct(field, filter?): Promise<value[]>
```

## Query builder

```typescript
find(filter).filter(f).sort(field, 'asc' | 'desc').limit(n).skip(n).select(fields).exec()
```

**Operadores de filtro:** `$eq` `$ne` `$gt` `$gte` `$lt` `$lte` `$in` `$nin`
`$contains` `$startsWith` `$endsWith`.

## Ejemplos

```javascript
const tasks = sdk.table('tasks');

await tasks.insert({ title: 'Build', status: 'pending', priority: 1 });

const urgent = await tasks
  .find({ status: { $in: ['pending', 'active'] }, priority: { $lte: 2 } })
  .sort('priority', 'asc')
  .limit(10)
  .exec();

const pending = await tasks.count({ status: 'pending' });
const statuses = await tasks.distinct('status');
```

## Manifest

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "tables": {
      "tasks": {
        "schema": [
          { "name": "id", "type": "string", "primary": true },
          { "name": "title", "type": "string" },
          { "name": "status", "type": "string" },
          { "name": "priority", "type": "number" }
        ]
      }
    }
  }
}
</script>
```

<Aside type="caution" title="El aislamiento por viewer es del lado del servidor">
Para mostrarle a cada cliente solo sus propias filas (dashboards multi-tenant), usá una
**access policy** definida al momento de publicar. Los filtros `find()` del lado del
cliente **no** aseguran los datos — el código fuente de la página es visible para los
viewers. El filtrado tiene que aplicarse del lado del servidor a partir de la identidad
del viewer logueado.
</Aside>

## Roles de escritura (manifest)

El campo `write` por tabla en el manifest restringe quién puede **mutar** filas
(`insert` / `update` / `delete`). Valores: `"any"` (default), `"collaborator"` u
`"owner"`. Las violaciones devuelven `403 TABLE_WRITE_FORBIDDEN`. Ver
[Manifest → tables](/es/spec/manifest/#sourcestables).

## Rendimiento

- Traé los datos una sola vez en la raíz de la app; pasalos hacia abajo como props.
- Paginá los conjuntos grandes con `.limit(50)`.
- Después de las mutaciones, `sdk.invalidateTableCache('tasks')`.
