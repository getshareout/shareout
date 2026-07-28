---
title: Archivos (assets del workspace)
description: Incrustá archivos del workspace en varios artifacts por su id estable de deliverable.
---

import { Aside } from '@astrojs/starlight/components';

Los **archivos del workspace** viven en la biblioteca Assets (ids `dlv_*`). A
diferencia de [`sdk.blobs`](/es/sdk/blobs/) — privados de un solo artifact —
los archivos son objetos de primer nivel del workspace que podés referenciar
desde cualquier página.

## Métodos

```typescript
getUrl(deliverableId: string): string
```

Devuelve la URL de contenido de un archivo por su id `dlv_` (siempre la
**última** versión):

```
https://shareout.site/v1/files/dlv_abc123/content
```

## Ejemplo

```javascript
const sdk = await ShareOut.create();

// Logo guardado una vez en Assets, usado en cada dashboard
const logoUrl = sdk.files.getUrl('dlv_abc123');
document.querySelector('#logo').src = logoUrl;
```

## Visibilidad

| Visibilidad del archivo | Quién puede obtener la URL |
| --- | --- |
| `workspace` (por defecto) | Cualquiera — incrustable en páginas y links de entrega |
| `private` | Owner, miembros del workspace (lectura) o sharees con grant de archivo/carpeta |

Los archivos privados devuelven **403** en la ruta de contenido para el resto. La
URL blob antigua por bucket también rechaza bytes de archivos privados — usá siempre
`sdk.files.getUrl()` para archivos del workspace.

<Aside type="tip">
Subí y gestioná archivos desde Home → **Assets**, o vía
[`/v1/workspaces/{id}/assets`](/es/teams/api/#assets-deliverables). Ver
[Archivos y entregas](/es/everyone/assets/) para carpetas, versiones, comentarios y
entregas a clientes.
</Aside>
