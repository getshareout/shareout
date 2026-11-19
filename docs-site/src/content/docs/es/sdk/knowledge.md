---
title: Búsqueda en Knowledge
description: Buscá lo que sabe el workspace — pasajes citados de sus Archivos y artefactos — desde un artefacto en ejecución.
---

import { Aside } from '@astrojs/starlight/components';

`sdk.knowledge.search()` busca en el [Knowledge](/es/teams/knowledge/) del workspace del
propio artefacto — los pasajes citados que aprendió de sus Archivos subidos (PDFs, docs,
planillas…) y de sus artefactos publicados — y devuelve los que responden una pregunta.
Sirve para un artefacto interno que tiene que citar políticas, contratos o reportes
anteriores.

<Aside type="note" title="Solo miembros">
Solo un **miembro interno con sesión iniciada** del workspace del artefacto recibe
resultados. Los visitantes anónimos, quienes entran con un link público y los sharees
externos reciben un error. El artefacto tiene que pertenecer a un workspace con
Knowledge activado.
</Aside>

## Método

```typescript
search(query: string, opts?: { limit?: number; full?: boolean }): Promise<{
  query: string;
  mode: 'hybrid' | 'keyword';
  hits: KnowledgeHit[];
}>
```

- `limit` — cuántos pasajes, de 1 a 30 (10 por defecto).
- `full` — `true` devuelve cada pasaje completo en vez de un fragmento de ~700 caracteres.

Cada resultado trae `text`, `locator` (la sección de donde salió), `score`, `cite`
(la cita lista para mostrar), `url` y `source: { kind, id, title, url }` — `kind` es
`page` o `asset` (un Archivo). `mode` es `hybrid` (significado + palabras clave) donde la
instancia tiene embeddings; si no, `keyword`.

## Ejemplo

```javascript
const sdk = await ShareOut.create();

const { hits } = await sdk.knowledge.search('periodicidad de inspección', { limit: 5 });
list.innerHTML = '';
for (const h of hits) {
  const li = document.createElement('li');
  li.textContent = `${h.text} — ${h.cite}`;
  list.appendChild(li);
}
```

Mostrá `cite` (y enlazá `source.url` cuando lo tiene) al lado de cada pasaje, así quien
lee encuentra el original.

## Quién ve qué

Los resultados se filtran para la persona que mira el artefacto: un artefacto o Archivo
privado de otro miembro nunca aparece, igual que en la búsqueda del propio workspace.
Cada llamada se cuenta en el uso de Knowledge del workspace.

## Errores

La llamada lanza un [`ShareOutError`](/es/sdk/overview/#errores):

| `status` | `code` | Cuándo |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | El visitante no inició sesión |
| 403 | `FORBIDDEN` | El visitante no es miembro interno del workspace, o el artefacto no tiene workspace |
| 404 | `NOT_FOUND` | Knowledge no está activado en el workspace |
| 400 | `INVALID_REQUEST` | Búsqueda vacía |

Equivalente REST: `GET /v1/data/{artifactId}/knowledge/search?q=&limit=&full=1`.
Para tokens de servicio y agentes, usá la ruta del workspace en
[Knowledge → API REST](/es/teams/knowledge/#api-rest).
