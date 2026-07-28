---
title: Resumen del SDK
description: El SDK de navegador para artifacts de ShareOut — datos, archivos, realtime, email, IA.
---

import { Aside } from '@astrojs/starlight/components';

Los artifacts publicados vienen con un SDK de navegador. Sumás una sola etiqueta de
script y tu página obtiene almacenamiento, subida de archivos, colaboración en tiempo
real, email, Python y un agente de chat con IA — sin ningún backend que cablear.

## Instalación

```html
<script src="https://shareout.site/sdk/shareout.js"></script>
<script>
  const sdk = await ShareOut.create();
</script>
```

<Aside type="caution">
Cargá siempre desde `https://shareout.site/sdk/shareout.js` (no desde un CDN de
terceros), y llamá a `ShareOut.create()` **después** de que el script se cargue. Un
error `ShareOut is not defined` significa que la URL del script o el orden está mal.
</Aside>

## Inicialización

```javascript
// Preferido para HTML publicado — espera el token de sesión del sandbox
const sdk = await ShareOut.create();

// Constructor sync — sirve para local/mock, pero hay race para datos en vivo en un iframe
const sdk = new ShareOut();
```

`artifactId` y `baseUrl` se autodetectan desde la URL. Los artifacts publicados corren
en un iframe sandboxeado; `create()` espera el token de vida corta que el frame padre
inyecta.

## Listo para mostrar y carga

El viewer muestra un **esqueleto de carga** con la marca mientras arranca tu artifact —
automáticamente, sin código. El SDK publica `shareout:content-ready` cuando tus llamadas
de datos se estabilizan, y el viewer quita el esqueleto.

```javascript
const sdk = await ShareOut.create();
renderEverything(await sdk.json.get('snapshot'));
ShareOut.ready(); // opcional: ocultá el esqueleto en el instante en que la página está pintada
```

`ShareOut.ready()` es opcional — sin él el SDK detecta el listo solo (red inactiva).
Llamalo para un hand-off más preciso, sobre todo en páginas con muchos gráficos. Mantené
el first paint rápido: leé datos iniciales desde `sdk.json`/`sdk.table()` (prefetch,
cero round-trip) y dejá `connection.query()` en vivo fuera del load path. Ver
[Renderizado rápido](/es/guides/performance/).

## Identidad del viewer

Usá `sdk.me()` para leer el rol e identidad del viewer actual dentro de un artifact.
Devuelve `{ role, isOwner, canEdit, email, name }`, desde datos que la plataforma
inyecta al servir. Viewers anónimos resuelven a `role: 'viewer'`.

```javascript
const me = await sdk.me();
if (me.canEdit) showAdminPanel();
else showClientView(me.email);
```

Los permisos del servidor siempre se aplican sin importar lo que devuelva `me()` — usalo
solo para ramificar la UI. La gestión de colaboradores es solo REST (no hay método SDK).

## Desarrollo local (modo mock)

En `file://`, `localhost` o `127.0.0.1` el SDK cambia automáticamente a un mock de
localStorage — sin red, sin auth. Forzalo con `new ShareOut({ mock: true })`, limpialo
con `sdk.clearMockData()`.

## Los tres niveles de datos

| Nivel | API | Para |
| --- | --- | --- |
| 1 | [`sdk.json`](/es/sdk/json/) | Estado simple — preferencias, flags, valores cacheados |
| 2 | [`sdk.table(name)`](/es/sdk/tables/) | Registros estructurados — tareas, leads, entradas |
| 2b | [`sdk.grid(name)`](/es/sdk/grid/) | Grilla editable (tabla o Sheets) |
| 3 | [`sdk.realtime(id)`](/es/sdk/realtime/) | Colaboración en vivo — documentos, pizarras |

## Todo lo demás

| API | Hace |
| --- | --- |
| [`sdk.blobs`](/es/sdk/blobs/) | Almacenamiento de archivos, servido directo desde R2 |
| [`sdk.files`](/es/sdk/files/) | Incrustar Assets del workspace (`dlv_*`) entre artifacts |
| [`sdk.email`](/es/sdk/email/) | Email de formulario de contacto al dueño del artifact |
| [`sdk.python`](/es/sdk/python/) | Ejecutá Python en el navegador (Pyodide) |
| [`sdk.agent`](/es/guides/ai-agent/) | Agente de chat para visitantes |
| [`sdk.crew`](/es/crew/overview/) | Agente autónomo del servidor (solo owner) |
| `sdk.me()` | Identidad y rol del viewer actual (para ramificar la UI) |
| `ShareOut.ready()` | Señal al viewer para ocultar el esqueleto de carga |
| `sdk.comments` | Comentarios en hilos |
| [`sdk.sources`](/es/sdk/sources/) | Drawer de procedencia de datos + badges "¿de dónde?" por elemento |
| `sdk.sheets` / `sdk.shopify` | [Integraciones](/es/integrations/overview/) |

## Manifest

La mayoría de los stores requieren que declares sus keys/schemas en un bloque de
manifest dentro del `<head>` de tu HTML:

```html
<script type="shareout/manifest">
{ "version": "2.0", "sources": { "json": { "counter": { "default": 0 } } } }
</script>
```

Cada página de store más abajo muestra la forma de su manifest.

## Errores

```javascript
try {
  await sdk.json.get('key');
} catch (e) {
  if (e instanceof ShareOutError) console.log(e.code, e.status, e.message);
}
```
