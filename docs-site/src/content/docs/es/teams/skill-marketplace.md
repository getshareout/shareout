---
title: Skill Marketplace
description: Catálogo por workspace de skills markdown reutilizables — publicar, rankear y adjuntar a artifacts para el agente de autoría.
---

import { Aside } from '@astrojs/starlight/components';

El **Skill Marketplace** es una función de Teams/Enterprise: un catálogo por
workspace de **skills** reutilizables — playbooks en markdown publicados como
artifacts. Los miembros exploran, votan y guardan skills en **Skill Market** en
la navegación izquierda, y los adjuntan a otros artifacts para que el agente de
**autoría** los reutilice al editar.

<Aside type="note">
Los skills son distintos de los [archivos de contexto del workspace](/es/teams/workspaces/#archivos-de-contexto-de-workspace)
(curados por admins, siempre activos, en build-time). Los skills los publican
miembros, son opt-in por artifact, e inyectan solo en el chat de autoría — nunca
en el chat de visitantes.
</Aside>

## Disponibilidad

Requiere plan **Teams o Enterprise** del dueño del workspace. Los espacios
personales no pueden publicar skills (`402 TEAMS_PLAN_REQUIRED`).

En la app de ShareOut, abrí un workspace de equipo y elegí **Skill Market** en
la navegación izquierda. Abrí cualquier skill desde **Library** o el marketplace para
leerlo en el **visor de skills** dentro del estudio (markdown renderizado con copiar/descargar).

## Recomendados por ShareOut

La lente **Library** de cada workspace muestra arriba una franja **Recommended by
ShareOut** — skills oficiales curados (autoría ShareOut, diseño, TDD, modelado de
dominio y más) mantenidos por ShareOut y actualizados con un sync diario. Son de
solo lectura, disponibles en **todos los planes** (incluidos espacios personales) y
se pueden adjuntar cross-workspace como cualquier otro skill.

```http
GET /v1/skills/recommended
Authorization: Bearer {token}
```

Devuelve `{ skills: [{ slug, artifact_id, name, summary, category, tags, attribution?, uses, url, official: true }] }`.
Agnóstico de workspace — cualquier usuario logueado puede listarlos. Los skills
oficiales viven en un workspace de sistema oculto; el endpoint combina metadata del
registro con ids de artifact y conteos de uso en vivo.

## Qué es un skill

Un skill es un `.md` publicado con `artifact_type: "skill"`. Se almacena como
markdown pero se sirve con un visor dedicado cuando está en el marketplace.

Los skills son siempre visibles para el `workspace` para que todos los miembros
exploren el catálogo.

### Frontmatter

YAML opcional en el entrypoint markdown:

```markdown
---
category: Design
tags: ui, branding
version: 1.2.0
summary: Cómo brandeamos dashboards
---

# Brand skill

Contenido…
```

| Campo | Uso |
| --- | --- |
| `category` | Filtro/grupo en el marketplace |
| `tags` | Chips de búsqueda |
| `version` | Versión mostrada |
| `summary` | Resumen en la tarjeta (si falta, primer párrafo) |

## Publicar un skill

```http
POST /v1/publish
```

```json
{
  "name": "Guía de marca",
  "slug": "guia-de-marca",
  "artifact_type": "skill",
  "workspace_id": "wsp_abc",
  "files": [
    { "path": "skill.md", "content": "---\ncategory: Design\n---\n# …", "mime": "text/markdown" }
  ]
}
```

`workspace_id` es obligatorio. La visibilidad se fuerza a `workspace`.

## Explorar y rankear

```http
GET /v1/workspaces/{id}/skills?sort=top&category=Design&q=marca&limit=30
GET /v1/workspaces/{id}/skills/categories
GET /v1/workspaces/{id}/skills/installed          ← lista "Mis Skills"
```

| `sort` | Orden |
| --- | --- |
| `top` (default) | Destacados primero, luego score (upvotes ×3 + attaches ×2 + installs ×1) |
| `trending` | Score con decaimiento temporal |
| `new` | Más recientes |
| `installed` | Usar `/skills/installed` |

Cada tarjeta incluye `upvotes`, `installs`, `attaches`, `uses` (solo display),
`voted` e `installed` para el usuario actual.

## Votar y guardar

```http
POST   /v1/artifacts/{skillId}/skill/vote      ← upvote (idempotente)
DELETE /v1/artifacts/{skillId}/skill/vote      ← quitar voto

POST   /v1/artifacts/{skillId}/skill/install    ← guardar en Mis Skills
DELETE /v1/artifacts/{skillId}/skill/install    ← quitar de guardados
```

## Adjuntar a un artifact

Hasta **5** skills por artifact (versión fijada). Los skills adjuntos cargan en
el system prompt del agente de **autoría** al editar ese artifact — no en el chat
de visitantes.

### Dónde aparecen los skills adjuntos

| Superficie | Quién lo ve |
| --- | --- |
| **Home** — tarjetas de artifacts | Badge Skills cuando el artifact tiene adjuntos |
| **Stats** → Skills adjuntos | Cualquier artifact con skills; el picker attach/detach requiere workspace de equipo |
| **Editor** — rail Details → Skills | Lista de solo lectura al editar |
| **Viewer** — toolbar flotante → **Skills N** | Visitantes autenticados (colaboradores, miembros del workspace); abre un popover de solo lectura con link a cada skill. Los visitantes anónimos no lo ven. |

```http
GET  /v1/artifacts/{artifactId}/skills
POST /v1/artifacts/{artifactId}/skills          ← { "skill_artifact_id": "art_skill", "position": 0 }
POST /v1/artifacts/{artifactId}/skills/{skillId}  ← actualizar a última versión del skill
DELETE /v1/artifacts/{artifactId}/skills/{skillId}
```

Al publicar también podés pasar `attached_skill_ids: ["art_skill1"]` en un
artifact que no sea skill.

Requiere rol `editor`+ en el artifact. Los skills deben pertenecer al mismo
workspace que el artifact destino.

## Adjuntar a tu agente (curación personal)

Separado de los adjuntos por artifact: cada miembro puede adjuntar hasta **8** skills al
**propio** asistente del workspace (chat de Home, Telegram, Slack). Se cargan como
material de referencia en cada conversación de ese miembro — no en el chat visitante ni
en los agentes de otros.

En **Library**, las tarjetas de skills oficiales y del workspace muestran **Attach to
agent** / **Attached to agent**. El scope es el id del workspace o `__personal` para el
chat personal de Home.

```http
GET  /v1/workspaces/{scope}/agent-skills
POST /v1/workspaces/{scope}/agent-skills   ← { "skill_artifact_id": "art_skill" }
DELETE /v1/workspaces/{scope}/agent-skills/{skillId}
```

`GET /v1/skills/{skillId}/markdown` devuelve el `SKILL.md` crudo para el visor (logueado;
el skill debe ser oficial o visible para vos).

## Moderación admin

Los admins del workspace pueden destacar o bloquear un skill:

```http
PATCH /v1/artifacts/{skillId}/skill/admin
{ "featured": true }
{ "blocked": true }
```

Los skills bloqueados desaparecen del catálogo.

## Relacionado

- [API de Teams](/es/teams/api/) — lista completa de endpoints
- [Agente de chat IA](/es/guides/ai-agent/) — agentes visitante vs autoría
- [Archivos de contexto](/es/teams/workspaces/#archivos-de-contexto-de-workspace) — docs siempre activos de admins
