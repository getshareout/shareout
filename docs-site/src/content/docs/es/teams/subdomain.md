---
title: Subdominios personalizados
description: Servís un workspace de Teams en {workspace}.shareout.site.
---

Los workspaces de Teams pueden servir artifacts en `{workspace}.shareout.site`
— un home con tu marca donde todas las URLs del workspace comparten el mismo
host.

## Routing

| URL | Sirve |
| --- | --- |
| `{workspace}.shareout.site/` | Landing / galería del workspace. |
| `{workspace}.shareout.site/{artifact-slug}` | Artifact en el workspace. |
| `{workspace}.shareout.site/{folder}/{artifact-slug}` | Artifact dentro de una carpeta. |

Los artifacts del workspace también son accesibles en `shareout.site/@{workspace}/{artifact}`.

## Espejo completo del producto

Un subdominio no es solo una galería pública — es un **espejo completo** de la app apex para
ese workspace. Estas rutas pasan sin cambios para que los miembros inicien sesión, abran Home,
editen artifacts y llamen APIs desde el host con marca:

`/v1/`, `/auth/`, `/sdk/`, `/embed/`, `/t/`, `/a/`, `/p/`, `/@`, `/brand/`, `/wl/`,
`/settings/`, `/app/`, `/home`, `/create`

Eso significa que `{workspace}.shareout.site/app/…` sirve las mismas superficies de Home y
studio que `shareout.site/app/…`, acotadas al contexto del workspace. Usá links relativos
dentro de artifacts y la UI del producto para que las páginas funcionen en ambos hosts.

## Habilitar

Requiere plan Teams y `admin` u `owner` en el workspace.

```http
POST /v1/workspaces/{workspaceId}/subdomain
Authorization: Bearer {token}
Content-Type: application/json

{ "enabled": true }
```

```json
{
  "success": true,
  "subdomain": "acme.shareout.site",
  "workspace_slug": "acme",
  "enabled": true
}
```

## Deshabilitar

```http
DELETE /v1/workspaces/{workspaceId}/subdomain
Authorization: Bearer {token}
```

## Consultar estado

```http
GET /v1/workspaces/{workspaceId}/subdomain
Authorization: Bearer {token}
```

## Slugs reservados

Estos slugs de workspace están reservados y no pueden usarse como subdominio:
`www`, `api`, `app`, `admin`, `cdn`, `static`, `mail`, `assets`, `support`,
`help`, `status`.

## Links dentro de artifacts

Usá links relativos dentro del HTML del artifact cuando deba funcionar tanto
en la URL del subdominio como en la URL canónica `shareout.site/@{workspace}/…`.
No hardcodees el hostname del subdominio.
