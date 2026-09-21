---
title: Skill Marketplace
description: Catálogo por workspace de skills markdown reutilizables — publicar, rankear y adjuntar a artifacts para el agente de autoría.
---

import { Aside } from '@astrojs/starlight/components';

El **Skill Marketplace** es un catálogo por workspace de **skills**
reutilizables — playbooks en markdown publicados como artifacts. Los miembros
exploran, votan y guardan skills en la lente **Library**, y los adjuntan a otros
artifacts para que el agente de **autoría** los reutilice al editar.

<Aside type="note">
Los skills son distintos de los [archivos de contexto del workspace](/es/teams/workspaces/#archivos-de-contexto-de-workspace)
(curados por admins, siempre activos, en build-time). Los skills los publican
miembros, son opt-in por artifact, e inyectan solo en el chat de autoría — nunca
en el chat de visitantes.
</Aside>

## Disponibilidad

No requiere plan — la única regla es que un skill pertenezca a un workspace. Un
publish personal (sin workspace) con `artifact_type: "skill"` se rechaza con
`400 SKILL_REQUIRES_WORKSPACE`.

En la app de ShareOut los skills viven en la lente **Library**, que abre en su
pestaña **Skills**: buscar, filtrar por categoría, publicar, leer, editar, revisar
cambios e instalar el catálogo en un agente.

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

YAML opcional en el entrypoint markdown. Usá `name` y `description` — las claves
de Agent Skills que leen todos los clientes:

```markdown
---
name: brand-guidelines
description: Cómo brandeamos dashboards
category: Design
tags: ui, branding
version: 1.2.0
---

# Brand skill

Contenido…
```

| Campo | Uso |
| --- | --- |
| `name` | Id del skill para un cliente Agent Skills. Si falta, se deriva del slug. |
| `description` | Para qué sirve el skill — el resumen de la tarjeta y lo que matchea un agente. |
| `category` | Filtro/grupo en la Library |
| `tags` | Términos de búsqueda |
| `version` | Versión mostrada |

`summary:` sigue funcionando como grafía heredada. Escriba lo que escriba el autor,
cada byte que ShareOut sirve para descarga o instalación lleva `name` + `description`
normalizados, así el archivo queda registrado en Claude Code, Cursor y cualquier otro
cliente que lea la convención.

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

Más simple, cuando solo tenés un nombre y un cuerpo:

```http
POST /v1/workspaces/{workspaceId}/skills
```

```json
{ "name": "Checklist de deploy", "markdown": "# Checklist de deploy\n\n…", "category": "Ingeniería" }
```

Es lo que llaman el botón **Nueva skill** de la Library y la tool `save_skill` del
asistente.

## Quién puede modificar una skill

| `edit_policy` | Puede republicar directo | Puede proponer un cambio |
| --- | --- | --- |
| `owner_only` *(por defecto)* | El dueño del skill, o un `editor` del artifact | — |
| `workspace` | Cualquier miembro del espacio | — |
| `approval` | Dueño / `editor` del artifact | Cualquier miembro del espacio |

```http
PUT /v1/skills/{skillId}/policy        ← { "edit_policy": "approval" }
PUT /v1/workspaces/{workspaceId}/skill-policy
                                       ← { "default_skill_edit_policy": "workspace" }
PUT /v1/skills/{skillId}/markdown      ← { "markdown": "# …" }
```

Cambiar la política requiere ser dueño del skill o admin del espacio. El default del
espacio aplica solo a skills **nuevas**. Con `approval`, guardar devuelve
`409 SKILL_REQUIRES_APPROVAL` y apunta a la ruta de propuestas:

```http
GET    /v1/skills/{skillId}/changes
POST   /v1/skills/{skillId}/changes             ← { "markdown", "title?", "note?" }
POST   /v1/skills/{skillId}/changes/{changeId}  ← { "action": "merge|reject|withdraw" }
```

Nada se aplica hasta el merge, que republica la skill como una versión nueva.

## Instalar en un agente

```bash
curl -fsSL https://shareout.site/v1/skills/install.sh | sh -s -- --workspace <slug-o-id>
```

Escribe todas las skills del espacio en `~/.claude/skills/<name>/SKILL.md`. Volvé a
correrlo para re-sincronizar. `--target cursor` escribe `.cursor/rules/<name>.mdc`;
`--list` previsualiza.

```http
GET /v1/skills/{skillId}/raw                       → text/markdown
GET /v1/workspaces/{workspaceId}/skills/index.json → formato de descubrimiento agentskills.io
```

El `/.well-known/agent-skills/index.json` de la instancia lista las skills oficiales
sin ningún token.

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
