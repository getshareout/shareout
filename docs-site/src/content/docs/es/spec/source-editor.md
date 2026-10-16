---
title: Editor de fuente
description: Editor en el browser para artefactos Markdown, TXT, JSON y CSV — endpoint de publicación, tipos soportados y flujo para agentes.
---

Los artefactos no-HTML tienen un **editor de fuente** en el browser en `/a/{slug}/edit`. Comparte el mismo patrón de URL y las mismas reglas de acceso que el [estudio visual](/es/spec/editor/), pero se abre en lugar de él cuando el tipo de artefacto es `markdown`, `txt`, `json` o `csv`.

## URLs

| URL | Propósito | Acceso |
|-----|-----------|--------|
| `/a/{slug}/edit` | Editor de fuente | Owner y colaboradores con rol editor (sesión requerida) |
| `/a/{slug}/` | Viewer en vivo | Según visibilidad del artefacto |

Las requests no autenticadas redirigen al login de Google con `redirect=/a/{slug}/edit`.

## Tipos soportados

| Tipo | Entry point por defecto | MIME |
|------|------------------------|------|
| `markdown` | `index.md` | `text/markdown` |
| `txt` | `index.txt` | `text/plain` |
| `json` | `index.json` | `application/json` |
| `csv` | `index.csv` | `text/csv` |

Los artefactos HTML abren el estudio visual en cambio. Enviar el slug de un artefacto HTML a `/edit` abre el estudio visual, no este editor.

## Publicar desde el editor

```http
POST /a/{slug}/edit/source/publish
Content-Type: application/json
Cookie: shareout_session=…

{ "content": "# Doc actualizado\n\nNuevo contenido acá." }
```

**Respuesta (200):**

```json
{
  "success": true,
  "versionNo": 3,
  "url": "https://shareout.site/a/my-doc/"
}
```

Cada publicación crea una nueva versión del artefacto, actualiza el metadata del tipo (conteos de filas, tabla de contenidos, etc.) e invalida los caches de deployment.

**Errores:**

| Código | Status | Causa |
|--------|--------|-------|
| `INVALID_REQUEST` | 400 | Falta el campo `content` |
| `UNSUPPORTED` | 400 | El tipo de artefacto no es editable como fuente (p. ej. `html`) |
| `ARTIFACT_NOT_FOUND` | 404 | El slug no resuelve |

## Flujo para agentes

Los agentes deben usar `POST /v1/publish` para crear o actualizar artefactos de texto programáticamente — no el endpoint del editor de fuente. El editor de fuente es para owners humanos que editan en el browser.

Para actualizar un artefacto de texto existente via la API, re-publicá con el mismo `slug` en el mismo workspace. El dedup coincide por `display_slug` y versiona en su lugar.

## Ver también

- [Editor visual](/es/spec/editor/) — estudio para artefactos HTML
- [Política de acceso](/es/spec/access-policy/) — filtrado de filas por viewer
