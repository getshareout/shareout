---
title: Comments
description: Comentarios anidados con actualizaciones en tiempo real para cualquier artifact.
---

import { Aside } from '@astrojs/starlight/components';

Comentarios anidados en tiempo real, asociados a un artifact o a cualquier contexto
dentro de él. Accedé vía `sdk.comments`.


## Envelope de respuesta

Las respuestas del data API usan:

```json
{ "success": true, "data": { "comments": [/* … */], "count": N } }
```

Leé **`data.comments`**, no `comments` en la raíz.

## Comentarios en archivos

Los hilos de un archivo viven en el artifact **bucket** del workspace, con
`contextId` **obligatorio** `file:<deliverableId>`. Sin ese contexto: `400 FILE_CONTEXT_REQUIRED`.
No hay WebSocket en buckets (la UI recarga al abrir).

Ver la guía completa en inglés: [Comments (EN)](/sdk/comments/).

## Métodos

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

// Configuración (solo owner)
getConfig(): Promise<CommentsConfig>
setConfig(config: Partial<CommentsConfig>): Promise<CommentsConfig>

// Tiempo real
subscribe(handler: (event: CommentEvent) => void): () => void
subscribeToContext(contextId: string, handler: (event: CommentEvent) => void): () => void
disconnect(): void

// Action items (sesión requerida)
resolve(id: string, resolved?: boolean): Promise<Comment>
assign(id: string, options?: { assignee?: string | null; dueAt?: string | null }): Promise<Comment>

// State bridge (comentarios anclados)
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

## Tipos

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
  // Campos de action item (presentes si está asignado)
  assigneeUserId?: string | null;
  assigneeEmail?: string | null;
  dueAt?: string | null;
}

interface CommentsConfig {
  enabled: boolean;
  identityMode: 'anonymous' | 'named' | 'authenticated';
  allowReplies: boolean;
  maxDepth: number;
  overlayEnabled?: boolean;
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

## Ejemplos

```javascript
// Configurar (solo owner)
await sdk.comments.setConfig({
  enabled: true,
  identityMode: 'named',
  allowReplies: true,
  maxDepth: 3,
});

// Agregar un comentario anclado a un slide
const comment = await sdk.comments.add({
  content: '¡Buen gráfico!',
  contextId: 'slide-5',
  authorName: 'Alice',
});

// Responder
await sdk.comments.reply(comment.id, '¡Gracias!', 'Bob');

// Consultar comentarios de primer nivel para un contexto
const comments = await sdk.comments
  .find({ contextId: 'slide-5' })
  .topLevel()
  .sort('createdAt', 'desc')
  .limit(50)
  .exec();

// Obtener el hilo completo anidado
const thread = await sdk.comments.getThread(comment.id);

// Actualizaciones en tiempo real
const unsub = sdk.comments.subscribeToContext('slide-5', (event) => {
  if (event.type === 'comment:added') renderComment(event.comment);
});
// Más tarde:
unsub();
```

## State bridge

Los comentarios anclados pueden capturar y restaurar el estado de la app (p. ej., filtros
activos de un dashboard). Registrá los callbacks antes de agregar comentarios:

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

Al agregar un comentario se almacena el estado actual. Al abrir un comentario anclado se
reproduce el estado vía `onRestoreState`.

## Action items

Cualquier comentario puede convertirse en un action item asignándolo a un miembro o
colaborador del workspace. El asignado recibe un email (y un mensaje de Telegram si
tiene la cuenta vinculada). Al resolver el comentario, el solicitante recibe una
notificación y puede reabrirlo con un clic.

**En el viewer del artifact:** abrí el panel de comentarios → botón **Assign** →
elegí una persona y, opcionalmente, una fecha límite.

**Vía API:**

```http
# Asignar al crear
POST /v1/data/{artifactId}/comments
{ "content": "Corregir el eje Y", "assignee": "alice@example.com", "dueAt": "2025-08-01T00:00:00Z" }

# Asignar o desasignar un comentario existente
PATCH /v1/data/{artifactId}/comments/{id}/assign
{ "assignee": "alice@example.com", "dueAt": "2025-08-01T00:00:00Z" }

# Desasignar
PATCH /v1/data/{artifactId}/comments/{id}/assign
{ "assignee": null }
```

El `assignee` debe estar en el conjunto de personas del artifact (miembros del workspace
+ colaboradores); las direcciones desconocidas devuelven `400 ASSIGNEE_NOT_FOUND`.

**Seguimiento:** todos ven sus action items abiertos en la **campana de notificaciones
del Home** — ordenados por fecha límite, los vencidos resaltados, con botones **Hecho**
y **Reabrir** inline.

**Filtrar por asignado:**

```http
GET /v1/data/{artifactId}/comments?assignee=me
GET /v1/data/{artifactId}/comments?assignee=alice@example.com
```

**Herramientas de crew IA:** `action_item_create`, `action_item_list`.

## Toolbar del viewer (UI integrada)

Con comentarios habilitados en una página, los viewers logueados ven una toolbar flotante:

| Función | Notas |
| --- | --- |
| Badge de no leídos | Se actualiza por WebSocket antes de abrir el panel |
| Filtros Abiertos / Resueltos | Cambiá la vista del hilo |
| Reacciones | 👍 ❤️ ✅ 🎉 👀 en cualquier comentario |
| Indicadores de escritura | Ves cuando alguien está escribiendo |
| Presencia | "N otros acá" en el encabezado (canal de comments, no analytics de página) |
| Resolver / Reabrir | Marcá hilos como hechos sin borrarlos |

Owners y colaboradores también gestionan hilos desde la pestaña **Comments** del
[Inspector del workspace](/es/everyone/your-workspace/#inspector-rail-derecho).

<Aside type="note" title="Transporte en tiempo real">
`subscribe` y `subscribeToContext` abren un WebSocket con reconexión exponencial
automática (hasta 10 intentos). Llamá a `disconnect()` para cerrar explícitamente. La
conexión se cierra automáticamente cuando todos los suscriptores se eliminan.
</Aside>


## Overlay del viewer

Según `identityMode` en `_comments_config`:

| Modo | Quién ve el panel |
| --- | --- |
| `anonymous` (default) | Cualquiera — nombre opcional |
| `named` | Cualquiera — nombre obligatorio al publicar |
| `authenticated` | Solo firmados (invitados ven *Log in to comment*) |

En páginas **private** / **workspace** el WebSocket exige sesión. Los archivos usan
`contextId=file:…` y no tienen realtime.

Guía completa (EN): [Comments](/sdk/comments/).
