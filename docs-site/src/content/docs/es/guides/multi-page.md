---
title: Artefactos de varias secciones
description: Publicá un sitio chico — varios archivos HTML en un mismo artefacto — con enlaces que no salen de él y una URL para cada sección.
---

Un artefacto puede tener más de un archivo HTML. Un manual, un micrositio o un informe con
anexos puede salir como un solo artefacto: un enlace para compartir, un historial de
versiones, y cada sección con su propia URL.

## Armá uno

Publicá un `index.html` (el entrypoint) y las demás secciones como archivos hermanos, en
carpetas si querés:

```json
{
  "name": "Manual de Acme",
  "slug": "manual-acme",
  "entrypoint": "index.html",
  "files": [
    { "path": "index.html", "content": "<a href=\"procedimientos/alta.html\">Alta</a> <a href=\"procedimientos/facturacion.html\">Facturación</a>" },
    { "path": "procedimientos/alta.html", "content": "<a href=\"../index.html\">Volver al manual</a>" },
    { "path": "procedimientos/facturacion.html", "content": "<a href=\"alta.html\">Alta</a>" }
  ]
}
```

Enlazá las secciones con hrefs **relativos** (`procedimientos/alta.html`, `../index.html`),
como en cualquier sitio estático. El CSS, el JS y las imágenes compartidas funcionan igual.

## Cómo se comportan los enlaces

| Enlace | Qué pasa |
| --- | --- |
| Enlace relativo a otra sección | Abre esa sección dentro del artefacto |
| Enlace absoluto al mismo artefacto (`/a/manual-acme/…` o la URL completa) | Se redirige para abrir dentro del artefacto, no un visor dentro del visor |
| Enlace a otro artefacto | Lo abre en su propia pestaña en Home, o en una pestaña nueva del navegador en otro lado |
| Cmd/Ctrl/Shift-clic, o un enlace `download` | Lo maneja el navegador |

También funciona con menús armados con JavaScript.

## Enlaces directos a una sección

La barra de direcciones sigue a la sección que se está mostrando, así que un enlace
copiado abre esa sección:

| Dónde | URL |
| --- | --- |
| Visor del artefacto | `/a/manual-acme/?page=procedimientos/alta.html` |
| Home | `#a/manual-acme/procedimientos/alta.html` |

Atrás y adelante del navegador se mueven entre secciones como esperás. `?page=` acepta solo
archivos HTML de la versión en vivo.

## Lista de secciones en Detalles

Cuando un artefacto tiene dos o más archivos HTML, **Detalles** en Home muestra
**Secciones (N)**. Elegí una para verla; el enlace de la barra de direcciones abre esa
sección.

## Alternativa en un solo archivo

Para un artefacto tipo app con vistas dentro de **un** solo HTML, usá
`data-shareout-page`. Mirá [Páginas, secciones y navegación](/es/spec/pages/). Se pueden
combinar las dos formas.

## Relacionado

- [Publicar artifacts](/es/guides/publishing/)
- [Historial de versiones y restauración](/es/everyone/version-history/)
