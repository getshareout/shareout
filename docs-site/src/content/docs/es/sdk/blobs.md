---
title: Blobs (archivos)
description: Subí y serví archivos, directo desde R2.
---

import { Aside } from '@astrojs/starlight/components';

Subí y serví archivos. Accedé vía `sdk.blobs`.

## Métodos

```typescript
upload(file, { filename?, mimeType? }): Promise<BlobInfo>
get(id): Promise<BlobInfo | null>
getDownloadUrl(id): Promise<string>   // short-lived, direct from R2 — preferred
getUrl(id): string                     // Worker-proxied, long-lived
delete(id): Promise<boolean>
list({ limit?, offset? }): Promise<BlobListResult>
storage(): Promise<StorageInfo>
```

## Ejemplos

```javascript
const file = document.querySelector('input[type=file]').files[0];
const blob = await sdk.blobs.upload(file);

// Large media — get a fresh signed URL each time you need it
imgEl.src = await sdk.blobs.getDownloadUrl(blob.id);

const { used, limit } = await sdk.blobs.storage();
```

<Aside type="tip" title="Ruta de subida vs descarga">
**Subidas desde el navegador** (dentro de un artifact publicado o el editor visual) pasan
por el proxy `_upload` del Worker — los iframes sandboxeados envían `Origin: null`, que
R2 CORS no puede atender, así que el PUT presignado directo falla desde el browser. El
Worker autentica y streamea los bytes a R2.

**Las descargas** siguen prefiriendo R2 directo: llamá `getDownloadUrl()` para una URL
firmada de vida corta (~5 min). `<img>` y tags similares no necesitan CORS, así que este
camino sigue siendo rápido.

**Callers servidor/CLI** (sin header `Origin`) mantienen la subida presignada directa a
R2. Los blobs son privados del artifact.
</Aside>

## Límites y tipos

| Restricción | Valor |
| --- | --- |
| Por archivo | 50 MB |
| Por artifact | 500 MB |
| Máximo de blobs | 1000 |
| Almacenamiento total de la instancia | `STORAGE_QUOTA_BYTES` (0 / sin set = ilimitado) |

Las subidas están limitadas por todos estos topes — gana el más estricto. El almacenamiento
total de la instancia se comparte con datasets y assets; superarlo devuelve `STORAGE_QUOTA_EXCEEDED`
(507) y un archivo que excede el tope devuelve `FILE_TOO_LARGE` (413).

Permitidos: imágenes (PNG/JPEG/GIF/WebP/SVG), video (MP4/WebM), audio (MP3/WAV/OGG),
PDF, TXT, CSV, Markdown.

## Manifest

```html
<script type="shareout/manifest">
{ "version": "2.0", "sources": { "blobs": ["logo.png", "document.pdf"] } }
</script>
```

Equivalentes REST: [Blobs API](/api/operations/uploadblob/).
