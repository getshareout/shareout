---
title: Renderizado rápido
description: First paint instantáneo para artifacts de ShareOut — esqueleto de carga, datos prefetch y ShareOut.ready().
---

Objetivo: el artifact muestra contenido — o al menos su estructura — de inmediato, nunca
una pantalla en blanco, mientras los datos cargan en segundo plano.

## Lo que el viewer ya hace por vos

- El wrapper del viewer streamea un **esqueleto de carga con la marca al instante** (gratis — sin código).
- Tu HTML del artifact streamea desde el CDN, así que **el markup estático se pinta a medida que llega**.
- El SDK publica `shareout:content-ready` **automáticamente** cuando tus llamadas de datos se estabilizan; el wrapper quita el esqueleto.

No construyas un esqueleto vos mismo. Tu trabajo es hacer que el momento *después* del esqueleto sea rápido y correcto.

## Los tres niveles de velocidad

| Contenido | Velocidad | Guía |
| --- | --- | --- |
| HTML estático (títulos, labels, layout, copy) | **Instantáneo** — streamea y pinta | Poné estructura/texto real en el markup, no `<div>` vacíos llenados por JS |
| `sdk.json` / `sdk.table()` | **Instantáneo** — prefetch del servidor e inyección | Los datos de first paint deberían venir de acá |
| `sdk.connection().query()` / REST en vivo | **1–3s** — query live de warehouse/API | Nunca bloquees el first paint con esto |

## Reglas

1. **Enviá HTML estático real.** Títulos, layout, labels, unidades, empty states — en el markup. La página debería verse como ella misma antes de que corra JS.
2. **Datos de first paint desde `json`/`table`.** Se prefetchean del lado del servidor y se inyectan, así `await sdk.json.get('snapshot')` resuelve con **cero round-trip de red**.
3. **No corras queries en vivo al cargar.** Precomputalas en `sdk.json` (o una tabla) con un job [`query_snapshot`](/es/guides/jobs/) programado, y leé el snapshot.
4. **Cargá en paralelo, hidratá por sección.** Si tenés que fetchear en runtime, usá `Promise.all` y llená cada sección cuando lleguen sus datos.
5. **Señalá listo cuando esté pintado.** Llamá `ShareOut.ready()` después de que termine tu render (tablas dibujadas, gráficos montados) para quitar el esqueleto en el momento exacto. Si lo omitís el SDK detecta el listo solo (red inactiva); llamarlo es más preciso en páginas con muchos gráficos.

## Dashboard snapshot-first (rápido)

```javascript
const sdk = await ShareOut.create();
// Instantáneo: snapshot precomputado, inyectado por el servidor (sin round-trip).
const s = (await sdk.json.get('snapshot')) || {};
renderTables(s);
await mountCharts(s);
ShareOut.ready();
```

Refrescá la key `snapshot` en schedule con un job `query_snapshot` para que el hit al warehouse live quede fuera del camino crítico.

## Query en vivo al cargar (lento — evitar)

```javascript
const sdk = await ShareOut.create();
// 1–3s en blanco: el warehouse corre la query antes de renderizar algo.
const rows = await sdk.connection('warehouse').query('SELECT ...');
render(rows);
```

Usá una query en vivo solo detrás de una acción explícita del usuario (un botón "Run"), nunca para first paint.

## Hidratación progresiva

```javascript
const sdk = await ShareOut.create();
renderShell(); // estructura estática pinta al instante
const [kpis, events] = await Promise.all([
  sdk.json.get('kpis'),
  sdk.table('events').query({ limit: 100 }),
]);
fillKpis(kpis);
fillTable(events);
ShareOut.ready();
```

## Checklist

- La estructura de la página (títulos, layout, labels) está en el HTML, no construida solo por JS
- Los datos de first paint leen de `sdk.json` / `sdk.table()`, no de una query en vivo
- `connection.query()` en vivo está precomputada vía `query_snapshot`, o detrás de una acción del usuario
- Los fetches en runtime corren en paralelo e hidratan por sección
- `ShareOut.ready()` se llama una vez que la página está pintada

## Relacionado

- [Resumen del SDK](/es/sdk/overview/) — `ShareOut.create()`, `ShareOut.ready()`, `sdk.me()`
- [Jobs programados](/es/guides/jobs/) — `query_snapshot` para refresh de warehouse fuera del camino crítico
- [Datos en vivo](/es/sdk/live-data/) — queries de conexión y el sandbox de dos orígenes
