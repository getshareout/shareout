---
title: Workspaces
description: Creá y administrá workspaces de Teams — miembros, roles, visibilidad y política de membresía.
---

import { Aside } from '@astrojs/starlight/components';

Un workspace es un contenedor compartido para artifacts, miembros, carpetas y
conectores. Cada workspace tiene su propia jerarquía de roles, política de
membresía y subdominio opcional.

## Crear un workspace

```http
POST /v1/workspaces
Authorization: Bearer {token}
Content-Type: application/json

{ "name": "Acme Analytics", "slug": "acme" }
```

## Obtener un workspace

```http
GET /v1/workspaces/{workspaceId}
GET /v1/workspaces/by-slug/{slug}
```

## Actualizar o eliminar

```http
PATCH /v1/workspaces/{workspaceId}
DELETE /v1/workspaces/{workspaceId}
```

Eliminar requiere el rol `owner` y cascadea las membresías.

## Miembros y roles

| Rol | Capacidades |
| --- | --- |
| `owner` | Control total del workspace, incluyendo eliminar y transferir propiedad. Puede editar **cualquier** artifact del workspace en Live Studio y Edit-Lite. |
| `admin` | Gestionar miembros, política, subdominio, conectores, schedules, automaciones. Puede editar **cualquier** artifact del workspace en Live Studio y Edit-Lite. |
| `member` | Crear/editar sus propios artifacts; ver artifacts con visibilidad workspace. Editar el artifact de otro miembro requiere invitación explícita como **editor**. |

| Método | Endpoint | Notas |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/members` | Listar miembros. |
| `POST` | `/v1/workspaces/{id}/members` | Agregar miembro; con política de acceso. |
| `DELETE` | `/v1/workspaces/{id}/members/{userId}` | Remover miembro. |
| `POST` | `/v1/workspaces/{id}/members/invite` | Invitar en bulk por email. |
| `GET` | `/v1/workspaces/{id}/members/metrics` | Métricas de actividad. Admin+. |
| `GET` | `/v1/workspaces/{id}/people` | Lista de personas para selector de UI. |
| `POST` | `/v1/workspaces/{id}/transfer-ownership` | Transferir a otro miembro. Solo owner. |

## Política de membresía

Controla quién puede unirse — separada de la `access_policy` por artifact.

```http
GET /v1/workspaces/{workspaceId}/access-policy
Authorization: Bearer {token}
```

```json
{
  "allowed_domains": ["example.com"],
  "allowed_emails": ["contractor@example.net"]
}
```

Configurar política (`admin` u `owner`):

```http
PUT /v1/workspaces/{workspaceId}/access-policy
Authorization: Bearer {token}
Content-Type: application/json

{
  "allowed_domains": ["example.com"],
  "allowed_emails": ["contractor@example.net"]
}
```

Reglas:

- `allowed_domains` — los usuarios con emails de esos dominios entran automáticamente como `member` al iniciar sesión.
- `allowed_emails` — lista de emails individuales fuera de los dominios permitidos.
- Mandá `[]` para limpiar una lista. Omití un campo para no modificarlo.
- Invitar fuera de la política: `403 DOMAIN_NOT_ALLOWED`.

## Visibilidad de workspace

Publicá un artifact con `visibility: "workspace"` para que todos los miembros
del workspace puedan verlo:

```json
{
  "workspace_id": "wsp_abc123",
  "visibility": "workspace"
}
```

La visibilidad `workspace` requiere que `workspace_id` esté definido.

## Archivos de contexto de workspace

Archivos markdown opcionales que enseñan a los agentes el estilo del equipo.
Los miembros los leen; los admins los administran.

```http
GET /v1/workspaces/{workspaceId}/context
GET /v1/workspaces/{workspaceId}/context/{name}
PUT /v1/workspaces/{workspaceId}/context/{name}
DELETE /v1/workspaces/{workspaceId}/context/{name}
PUT /v1/workspaces/{workspaceId}/context          ← definir entry: { "entry": "index.md" }
```

Las escrituras requieren `admin` u `owner`. Los archivos deben ser `.md` en
minúsculas y pesar ≤ 64 KB.

Archivos recomendados:

| Archivo | Contenido |
| --- | --- |
| `index.md` | Entry point corto, reglas principales, links a otros archivos. |
| `style.md` | Colores, fuentes, layout, logo, convenciones de gráficos. |
| `voice.md` | Tono, terminología, palabras a usar/evitar. |
| `conventions.md` | Estructura de reportes y dashboards. |
| `data.md` | Nombres de conectores, definiciones de métricas, tablas clave. |

Los agentes pueden traer el skill con contexto del workspace vía:

```http
GET /v1/skill?workspace={workspaceSlugOrId}
Authorization: Bearer {token}
```

## Branding

Subí un logo y configurá colores del workspace:

```http
POST /v1/workspaces/{workspaceId}/logo
PUT /v1/workspaces/{workspaceId}/branding
GET /v1/workspaces/{workspaceId}/branding
DELETE /v1/workspaces/{workspaceId}/logo
```

<Aside type="tip">
Mirá [Subdominios](/es/teams/subdomain/) para servir los artifacts del
workspace en `{workspace}.shareout.site`.
</Aside>

## Modelo Personal vs workspace

Los artifacts sin `workspace_id` pertenecen al espacio **Personal** del owner.
Definir `workspace_id` al publicar mueve el artifact al workspace — aparece en
el Team Space junto con carpetas y contenido con visibilidad workspace.

En el home, usá el **selector de avatar** para moverte entre Personal y cada workspace de
equipo al que pertenecés. Personal y Team Space tienen sus propias carpetas en una barra
superior unificada.

El [Home del workspace](/es/everyone/your-workspace/) rediseñado agrega artifacts en
pestañas, el Inspector (Details, Comments, Automate), modo Edit rápido y el feed Activity
(Needs You + Pulse).
