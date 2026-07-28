---
title: Resumen de la especificación de artifact
description: Qué es un artifact HTML de ShareOut y cómo funciona el modelo de manifest.
---

Un artifact de ShareOut es un archivo HTML autocontenido publicado en ShareOut y servido
en una URL estable. El archivo es dueño de sus datos: las claves de almacenamiento, los
esquemas de tablas y los IDs de documentos realtime se declaran dentro del archivo mismo,
en un bloque de manifest. El SDK de ShareOut lee el manifest para conectar la persistencia;
el editor visual lo lee para poblar su panel de datos y el autocompletado.

## Lo que requiere la especificación

Todo artifact debe incluir cuatro cosas:

| Elemento | Propósito |
|----------|----------|
| `<script type="shareout/manifest">` | Declara todas las fuentes de datos — obligatorio en `<head>` |
| `data-shareout-page` | Marca los contenedores de página — obligatorio en cada elemento de página |
| `data-shareout-binding` | Conecta un elemento a un valor de datos — obligatorio para todo contenido dinámico |
| `data-shareout-template` | Marca contenido repetitivo impulsado por una tabla o array JSON |

Sin el manifest, el editor muestra paneles vacíos y no ofrece autocompletado. Sin
`data-shareout-page`, la navegación por el esquema queda en blanco. Sin
`data-shareout-binding`, el editor no puede rastrear qué valores están en uso.

La publicación **nunca se bloquea** por gaps de spec — los artifacts quedan en vivo igual.
Cada publish HTML devuelve un perfil advisory `editor_readiness` (ver [Publicar](/es/guides/publishing/))
que califica estos marcadores y nombra qué deshabilita cada gap en el estudio.

## Referencia de atributos

| Atributo | Ejemplo de valor | Propósito |
|----------|-----------------|----------|
| `data-shareout-page` | `"dashboard"` | ID del contenedor de página |
| `data-shareout-page-title` | `"Dashboard"` | Nombre visible en el esquema del editor |
| `data-shareout-section` | `"kpis"` | Sección dentro de una página |
| `data-shareout-section-title` | `"Key Metrics"` | Nombre visible de la sección |
| `data-shareout-sortable` | _(presente)_ o `"x"` | Habilita reordenamiento por arrastre en el editor |
| `data-shareout-tabs` | `"views"` | ID del contenedor de grupo de tabs |
| `data-shareout-tab` | `"daily"` | ID de un tab individual |
| `data-shareout-binding` | `"json:metrics.revenue"` | Expresión de binding de datos |
| `data-shareout-format` | `"currency"` | Formato de visualización |
| `data-shareout-editable` | `"true"` | Habilita edición in-place |
| `data-shareout-template` | `"task-row"` | Nombre de template para ítems repetitivos |
| `data-shareout-chart` | `'{"type":"line"}'` | JSON de configuración de gráfico |
| `data-shareout-realtime` | `"board-sync"` | ID de documento Y.js realtime |
| `data-shareout-action` | `"navigate"` | Tipo de acción en elemento interactivo |
| `data-shareout-if` | `"json:user.loggedIn = true"` | Visibilidad condicional |
| `data-shareout-nav` | `"main"` | ID del contenedor de navegación |
| `data-shareout-link` | `"page:dashboard"` | Destino de un enlace de navegación |

## Matriz de funcionalidades del editor

| Funcionalidad del editor | Lo que necesita | Consecuencia si falta |
|--------------------------|----------------|----------------------|
| Panel de datos | `sources` en el manifest | Panel vacío |
| Autocompletado | `sources` en el manifest | Sin sugerencias |
| Vista previa mock | Valores `default` en json, tablas y conexiones | Preview vacío (sin fetch en vivo en el estudio) |
| Esquema de páginas | `data-shareout-page` | Sin esquema |
| Esquema de secciones | `data-shareout-section` | Esquema plano |
| Rastreo de variables | `data-shareout-binding` | Variables invisibles |
| Edición de templates | `data-shareout-template` | No se pueden agregar/quitar filas |
| Diagrama de acciones | `data-shareout-action` | Sin visualización de acciones |

## Checklist de cumplimiento

Antes de publicar un artifact, verificá:

- `<script type="shareout/manifest">` existe en `<head>` con `"version": "2.0"`
- Cada key de `sdk.json` está declarada en `sources.json`
- Cada nombre de `sdk.table()` está declarado en `sources.tables`
- Cada elemento de página tiene `data-shareout-page`
- Cada valor dinámico tiene `data-shareout-binding`
- El contenido repetitivo usa `data-shareout-template`
- Datos de muestra `default` en sources json, tablas y **conexiones** (los conectores live hacen preview desde defaults del manifest — sin query en el estudio)

## Relacionado

- [Manifest](/es/spec/manifest/) — esquema completo del manifest y referencia de campos
- [Bindings](/es/spec/bindings/) — sintaxis de expresiones de binding y formatos
- [Templates](/es/spec/templates/) — contenido repetitivo, gráficos, realtime
- [Páginas](/es/spec/pages/) — estructura de páginas, secciones, tabs y navegación
- [JSON store](/es/sdk/json/) — API de `sdk.json`
- [Tables](/es/sdk/tables/) — API de `sdk.table()`
