---
title: Visión general de Teams
description: Workspaces, roles, subdominios, conectores y herramientas de admin.
---

import { Aside } from '@astrojs/starlight/components';

Los workspaces se construyen sobre el sistema base de artifacts de ShareOut: todo
lo que hacen los artifacts personales sigue funcionando, más membresía de
workspace, visibilidad interna, subdominios personalizados, conectores de datos a
nivel workspace y herramientas de administración.

## Sin planes

Este es el árbol open source. No hay tiers, ni checkout, ni features atadas a una
suscripción — la membresía de workspace, la visibilidad interna, los subdominios
personalizados, los conectores y las herramientas de admin están todas activas.
"Teams" acá nombra un conjunto de capacidades, no algo que se compra.

Apagá features puntuales por workspace en **Admin → Features** si querés una
superficie más chica.

## Asientos

`GET /v1/workspaces/{id}` reporta el uso de asientos para que los admins vean el
tamaño del workspace:

```json
{
  "seats": { "used": 12, "limit": null, "remaining": null }
}
```

`limit` y `remaining` son siempre `null` — la membresía es ilimitada.

## Qué agrega Teams

| Capacidad | Dónde |
| --- | --- |
| Membresía de workspace y roles | [Workspaces](/es/teams/workspaces/) |
| Visibilidad `workspace` de artifacts | [Workspaces](/es/teams/workspaces/) |
| Política de membresía (dominios/emails permitidos) | [Workspaces](/es/teams/workspaces/) |
| Carpetas del Team Space | [Carpetas](/es/teams/folders/) |
| Subdominio personalizado (`{workspace}.shareout.site`) | [Subdominios](/es/teams/subdomain/) |
| Conectores de datos compartidos y por usuario | [Conexiones](/es/teams/connections/) |
| Asistente del workspace (concierge + consultas de solo lectura) | [Asistente del workspace](/es/teams/workspace-assistant/) |
| Skill Marketplace (skills markdown reutilizables para agentes) | [Skill Marketplace](/es/teams/skill-marketplace/) |
| Gobernanza de publicación por workspace (aprobación antes de ir a público) | [Admin](/es/teams/admin/#politica-de-publicacion) |
| Archivos de contexto de workspace (estilo para agentes) | [Workspaces](/es/teams/workspaces/) |
| Admin de workspace (schedules, automaciones, alertas) | [Admin](/es/teams/admin/) |
| Compartir con externos (Clientes, portal, API acotada, recibos) | [Compartir con clientes](/es/teams/external-sharing/) |
| API REST de Teams | [Referencia de la API](/es/teams/api/) |

## Roles de workspace

| Rol | Capacidades |
| --- | --- |
| `owner` | Control total del workspace. |
| `admin` | Gestionar miembros, política, subdominio, configuraciones, schedules, automaciones. |
| `member` | Crear/editar sus propios artifacts; ver artifacts con visibilidad workspace. |

No confundas los roles de workspace (`owner`/`admin`/`member`) con los roles de
colaborador de artifact (`owner`/`editor`/`viewer`).

## Visibilidad de artifacts

| Valor | Quién puede ver |
| --- | --- |
| `private` | El owner más colaboradores explícitos. Por defecto. |
| `workspace` | Todos los miembros del workspace del artifact. |
| `public` | Cualquiera en internet con el enlace; descubrible. |

Usá `visibility: "workspace"` solo cuando el artifact tenga `workspace_id` definido.

<Aside type="caution">
Los endpoints exclusivos de Teams devuelven `402 TIER_REQUIRED` con
`required_tier: "team"` cuando se los llama desde una cuenta Personal.
</Aside>
