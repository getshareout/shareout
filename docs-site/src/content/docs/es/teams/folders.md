---
title: Carpetas del Team Space
description: Organizá los artifacts del workspace en carpetas compartidas visibles para todos los miembros.
---

import { Aside } from '@astrojs/starlight/components';

Las **carpetas del Team Space** son carpetas compartidas dentro de un workspace
de Teams. Todos los miembros pueden verlas y mover artifacts. `owner` y `admin`
crean, renombran y eliminan cualquier carpeta. Los miembros crean carpetas y
renombran o eliminan las que crearon, salvo que un admin haya desactivado
**Los miembros pueden crear carpetas** (Admin → Settings, o
`members_can_create_folders` en `PATCH /v1/workspaces/{id}`).

<Aside>
Las carpetas personales (fuera de cualquier workspace) usan `/v1/folders`.
Esta página cubre solo carpetas de workspace.
</Aside>

## Alcances

| Alcance | Visible para | Creación de carpetas | Prefijo de API |
| --- | --- | --- | --- |
| Team Space | Todos los miembros del workspace | `owner` / `admin`; `member` salvo que esté desactivado | `/v1/workspaces/{id}/folders` |
| Personal | Owner (+ cuentas vinculadas) | Owner | `/v1/folders` |

## Enlaces y acceso

**Compartí el enlace de una carpeta.** Al abrir una carpeta en Home, la barra de
direcciones queda en `#l/artifacts/<folderId>`: un marcador o un enlace pegado abre esa
carpeta con sus breadcrumbs, y atrás/adelante funcionan. **Copiar enlace** en el
encabezado de la carpeta lo copia.

**Mirá quién tiene acceso.** El encabezado de la carpeta muestra una etiqueta de acceso
— **Privada**, **Espacio de trabajo**, **Pública** o **Compartida con externos** — con los
avatares de las personas y orgs de clientes que tienen acceso por esta carpeta o por una
superior. Una carpeta en **Igual que la carpeta superior** muestra el acceso que hereda
("Heredado de …").

**Gestioná el acceso.** Hacé clic en la etiqueta para abrir **Quién tiene acceso**. Quien
gestiona la carpeta puede:

- cambiar la **Visibilidad**: Igual que la carpeta superior, Espacio de trabajo, Pública o
  Privada;
- compartir con alguien de afuera del workspace por email, con **View** o **Comment**, y
  una fecha de fin opcional (7, 30 o 90 días, o una fecha);
- **Quitar** a una persona;
- ver **Quién abrió qué**: qué abrieron, comentaron o descargaron en esta carpeta las
  personas de afuera del workspace;
- **Copiar enlace del portal del cliente**.

Gestionan la carpeta los owners y admins del workspace, y también quien la creó mientras
**Los miembros pueden crear carpetas** esté activado. El resto ve el panel en modo solo
lectura. Más en [Portales de clientes](/es/teams/client-portals/).

<Aside type="caution">
La visibilidad de una carpeta se muestra en la carpeta y define la etiqueta de acceso. No
reemplaza la visibilidad de cada artefacto que contiene; esa se configura por artefacto.
</Aside>

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
| `403 ADMIN_REQUIRED` | Un miembro intentó crear una carpeta con la opción desactivada, o cambiar una que creó otra persona. |
| `409 SLUG_CONFLICT` | El slug ya existe en este nivel de carpeta. |
