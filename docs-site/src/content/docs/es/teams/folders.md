---
title: Carpetas del Team Space
description: Organizá los artifacts del workspace en carpetas compartidas visibles para todos los miembros.
---

import { Aside } from '@astrojs/starlight/components';

Las **carpetas del Team Space** son carpetas compartidas dentro de un workspace
de Teams. Todos los miembros pueden verlas y mover artifacts; solo `owner` y
`admin` pueden crear, renombrar o eliminar carpetas.

<Aside>
Las carpetas personales (fuera de cualquier workspace) usan `/v1/folders`.
Esta página cubre solo carpetas de workspace.
</Aside>

## Alcances

| Alcance | Visible para | Creación de carpetas | Prefijo de API |
| --- | --- | --- | --- |
| Team Space | Todos los miembros del workspace | Solo `owner` / `admin` | `/v1/workspaces/{id}/folders` |
| Personal | Owner (+ cuentas vinculadas) | Owner | `/v1/folders` |

## Endpoints

```http
GET    /v1/workspaces/{workspaceId}/folders
POST   /v1/workspaces/{workspaceId}/folders
GET    /v1/workspaces/{workspaceId}/folders/{folderId}
PATCH  /v1/workspaces/{workspaceId}/folders/{folderId}
DELETE /v1/workspaces/{workspaceId}/folders/{folderId}
GET    /v1/workspaces/{workspaceId}/folders/by-path/{path}
POST   /v1/workspaces/{workspaceId}/artifacts/{artifactId}/move
```

Todas las rutas requieren membresía de workspace. Crear, actualizar y eliminar
requieren `owner` o `admin`.

## Listar carpetas

```http
GET /v1/workspaces/{workspaceId}/folders?parent_id={folderId}
Authorization: Bearer {token}
```

Omití `parent_id` para las carpetas raíz. Cada item incluye `artifact_count`,
`subfolder_count`, `visibility` y `parent_id`.

## Crear una carpeta

```http
POST /v1/workspaces/{workspaceId}/folders
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Reportes Q1",
  "slug": "reportes-q1",
  "description": "Dashboards trimestrales",
  "parent_id": null,
  "visibility": "inherit"
}
```

Opciones de `visibility`:

| Valor | Efecto |
| --- | --- |
| `inherit` | Los artifacts heredan la visibilidad del workspace de la carpeta. Por defecto. |
| `private` | Solo colaboradores explícitos. |
| `workspace` | Todos los miembros del workspace. |
| `public` | Acceso abierto en la web. |

Los slugs son únicos por nivel de carpeta dentro del workspace.

## Mover un artifact a una carpeta

Cualquier miembro del workspace puede archivar un artifact del workspace:

```http
POST /v1/workspaces/{workspaceId}/artifacts/{artifactId}/move
Authorization: Bearer {token}
Content-Type: application/json

{ "folder_id": "fld_abc" }
```

Pasá `"folder_id": null` para quitarlo de toda carpeta.

## URLs

Los slugs de carpeta aparecen en las URLs de subdominio y con namespace:

| Patrón | Ejemplo |
| --- | --- |
| `{ws}.shareout.site/{folder}/{artifact-slug}` | `acme.shareout.site/reportes-q1/ventas-dashboard` |
| `shareout.site/@{ws}/{folder}/{artifact-slug}` | `shareout.site/@acme/reportes-q1/ventas-dashboard` |

El slug en estas URLs es el human slug del artifact (`display_slug`), único
por workspace.

## Errores

| Código | Significado |
| --- | --- |
| `403 ADMIN_REQUIRED` | Un miembro intentó crear o eliminar una carpeta. |
| `409 SLUG_CONFLICT` | El slug ya existe en este nivel de carpeta. |
