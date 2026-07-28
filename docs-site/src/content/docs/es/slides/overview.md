---
title: Slides — introducción
description: Presentaciones colaborativas con edición en tiempo real, modo presentador e historial de versiones, integradas en ShareOut.
---

Slides es el módulo de presentaciones integrado en la infraestructura de ShareOut. Cada deck es un artifact vivo con dos URLs —una para editar, otra para compartir— respaldado por un documento Y.js CRDT.

## Cuándo usar Slides

| Situación | Por qué encaja Slides |
| --- | --- |
| Colaboración en equipo | Edición en tiempo real sin conflictos vía Y.js |
| Decks de ventas o demos | URL publicada compartible, sin paso de exportación |
| Capacitación o charlas | Notas del presentador, temporizador, puntero láser |
| Contenido con datos | Canvas HTML libre — incorporá cualquier gráfico o widget |

Para documentos estáticos sin datos interactivos, un [artifact publicado](/es/guides/publishing/) estándar puede ser más simple.

## Present this (deck con IA)

Convertí cualquier página HTML publicada en un **deck de slides** hermano — la IA
lee el HTML de producción, arma un outline reveal.js de 5–9 diapositivas y publica
un **artifact nuevo privado** en el mismo workspace. Rate limit por usuario; requiere
IA configurada.

```http
POST /v1/artifacts/{id}/present
Authorization: Bearer {token}
```

Devuelve `{ "artifact_id", "url" }` del deck nuevo. El asistente del workspace
también expone la herramienta `present_artifact`. Abrí el resultado en Home como
cualquier otra página — editá en Slides o Edit rápido y publicá cuando esté listo.

## URL de edición vs publicada

Cada presentación tiene dos artifacts creados al mismo tiempo:

| Modo | URL | Acceso |
| --- | --- | --- |
| Editor | `shareout.site/a/{slug}` | Colaboradores autenticados |
| Publicada | `shareout.site/p/{slug}` | Cualquiera (según visibilidad) |

Los cambios del editor se propagan a la vista publicada en tiempo real por WebSocket — la latencia típica es de 50–200 ms.

## Arquitectura

Una presentación es un único documento Y.js con cinco maps:

- `meta` — título, dimensiones, fuentes, colores, transición por defecto
- `slides` — array ordenado de metadata de slides (id, owner, overrides, hidden, locked)
- `slideContent` — HTML de cada slide como `Y.Text` para sincronización colaborativa a nivel de carácter
- `speakerNotes` — notas Markdown por slide como `Y.Text`
- `presentationState` — estado en vivo del presentador (slide actual, posición del láser, cuenta regresiva)

Los medios (imágenes, video) se almacenan en [blobs](/es/sdk/blobs/) y se referencian por blob ID desde el HTML de los slides.

## Inicio rápido

```javascript
const sdk = new ShareOut();

// 1. Crear una presentación
const { editorUrl, publishedUrl } = await sdk.slides.create({
  title: 'Revisión Q4',
  aspectRatio: '16:9',
  visibility: 'public',
});

// 2. Abrir y agregar slides
const presentation = await sdk.slides.open('revision-q4');
await presentation.connect();

const slide = presentation.slides.add();
presentation.slides.setContent(slide.id, '<h1>Resultados Q4</h1>');

// 3. Observar cambios en tiempo real de los colaboradores
presentation.slides.observe(slides => renderSlideList(slides));
```

## Publicar un slides artifact

`sdk.slides.create()` llama a `POST /v1/publish` internamente y devuelve los IDs de ambos artifacts. No publicás slides a través del endpoint de publicación estándar — usá `sdk.slides.create()`.

La visibilidad se puede cambiar en cualquier momento:

```javascript
presentation.publish.setVisibility('public');   // 'private' | 'workspace' | 'public'
presentation.publish.unpublish();               // ocultar temporalmente
presentation.publish.republish();               // restaurar
```

(`unlisted` es un alias legacy retirado, aún aceptado en la API y tratado como `public`.)

El link compartible siempre es la URL publicada:

```javascript
const url = presentation.publish.getUrl();
// https://shareout.site/p/revision-q4
```

## Características principales

- **Canvas HTML libre** — cada slide almacena HTML en bruto; sin restricciones de elementos
- **Metadata en cascada** — configurá fuentes y colores una vez en la presentación; los slides heredan salvo que sobrescriban
- **Propiedad por slide** — asigná un usuario como owner de slides específicos; bloqueálos para evitar que otros editores los modifiquen
- **Historial de versiones** — snapshots con nombre más checkpoints automáticos; restauración con una llamada
- **Modo presentador** — vista del presentador con notas, temporizador, puntero láser; la audiencia sigue automáticamente
- **Generación con IA** — `sdk.slides.generate({ prompt, theme })` crea un deck completo desde un prompt

## Próximos pasos

- [Creación de decks](/es/slides/authoring/) — helpers de layout, temas, crear con contenido
- [Referencia de la API del SDK](/es/slides/sdk-api/) — firmas completas de métodos
- [Modo presentador](/es/slides/presenter-mode/) — vista del presentador, navegación, láser, versiones
