---
title: Dashboards — introducción
description: Dashboards colaborativos en tiempo real con datos en vivo, filtros interactivos y modo presentador.
---

Los dashboards son artifacts colaborativos en tiempo real. Los construís en un
editor autenticado y compartís una URL de solo lectura separada — ambas se
mantienen sincronizadas sobre un documento Y.js en vivo.

## Cuándo usar dashboards

| Escenario | Funcionalidades clave |
| --- | --- |
| Reportes ejecutivos | KPIs, gráficos de tendencia, presets de filtros |
| Análisis de ventas | Funnel de pipeline, leaderboard, drill-down |
| Monitoreo operacional | Métricas en vivo, auto-refresh, fuentes WebSocket |
| Analítica de marketing | Performance de campañas, funnel de conversión |
| Reportes financieros | P&L, comparaciones por período |
| Pantallas de TV | Modo presentador, ciclo automático, pantalla completa |

Usá dashboards cuando necesitás colaboración en tiempo real, filtros interactivos
o modo presentador. Para reportes estáticos o embeds simples, un artifact
convencional con el [JSON store](/es/sdk/json/) o [tables](/es/sdk/tables/) es
más sencillo.

## Dos URLs, un documento

Cada dashboard crea dos artifacts que comparten un único documento CRDT Y.js:

| Modo | URL | Acceso |
| --- | --- | --- |
| Editor | `shareout.site/a/{slug}` | Autenticado; edición completa |
| Publicado | `shareout.site/p/{slug}` | Compartible; solo lectura, filtros interactivos |

Los cambios en el editor se propagan a la vista publicada en tiempo real (latencia
típica 50–200 ms). El viewer publicado puede aplicar filtros y seguir a un
presentador, pero no puede modificar la definición de widgets ni las fuentes de datos.

En workspaces de Teams, ambas URLs también están disponibles bajo el subdominio del
workspace: `{workspace}.shareout.site/a/{slug}` y `{workspace}.shareout.site/p/{slug}`.

## Publicación

### Crear

```javascript
const sdk = new ShareOut();

const result = await sdk.dashboards.create({
  title: 'Sales Dashboard',
  visibility: 'public',
});

console.log(result.editorUrl);    // shareout.site/a/sales-dashboard
console.log(result.publishedUrl); // shareout.site/p/sales-dashboard
```

Ambos artifacts se crean automáticamente. También se devuelven
`editorArtifactId` y `publishedArtifactId` por si los necesitás para llamadas
a la API.

### Visibilidad

| Valor | Quién puede ver la URL publicada |
| --- | --- |
| `private` | Solo colaboradores; requiere autenticación |
| `workspace` | Cualquier miembro del workspace del artifact (Teams) |
| `public` | Cualquiera en internet con el enlace; aparece en la homepage del workspace (Teams) |

Podés cambiar la visibilidad en cualquier momento:

```javascript
const dashboard = await sdk.dashboards.open('sales-dashboard');
dashboard.publish.setVisibility('public');
```

### Despublicar / republicar

```javascript
dashboard.publish.unpublish();  // la URL publicada devuelve 404
dashboard.publish.republish();  // restaurar
```

### Embed

Los dashboards públicos son embebibles por defecto:

```html
<iframe
  src="https://shareout.site/embed/my-dashboard/"
  width="100%"
  height="600"
  frameborder="0"
></iframe>
```

Restringí orígenes o deshabilitá el embed vía la API de artifacts (campos
`embed_allowed` y `embed_origins` en `PATCH /v1/artifacts/{id}`).

## Integración con el SDK

Los dashboards se apoyan en primitivas existentes del SDK:

| Feature del SDK | Rol en dashboards |
| --- | --- |
| `sdk.realtime()` | Documento Y.js subyacente |
| `sdk.blobs` | Almacenamiento de imágenes para widgets |
| `sdk.comments` | Hilos por widget (`contextId: 'widget-{id}'`) |
| `sdk.table()` | Tipo de fuente de datos `shareout` para widgets |

Consultá [Widgets y gráficos](/es/dashboards/widgets/) para tipos de widgets y
layout, y [API del SDK](/es/dashboards/sdk-api/) para la referencia completa de métodos.
