---
title: Creación de decks
description: Helpers de layout, temas y creación masiva de contenido para ShareOut Slides.
---

Slides almacena HTML en bruto por slide — tenés libertad creativa total. Los helpers descritos acá generan snippets HTML y layouts completos de slides ya alineados con el diseño; no restringen lo que podés escribir.

## Flujo básico

```javascript
const presentation = await sdk.slides.open('mi-deck');
await presentation.connect();

const slide = presentation.slides.add();
presentation.slides.setContent(slide.id, `
  <div style="display:flex;flex-direction:column;justify-content:center;
              align-items:center;height:100%;text-align:center;padding:48px">
    <h1 style="font-size:64px;font-weight:700">Resultados Q4</h1>
    <p style="font-size:24px;color:var(--text-secondary);margin-top:16px">Revisión Anual 2026</p>
  </div>
`);
```

Las variables CSS (`--bg-primary`, `--text-primary`, `--text-secondary`, `--accent`) se inyectan desde la metadata `defaultColors` de la presentación, de modo que los slides se reestilizan automáticamente cuando cambiás el tema.

## Temas

Configurá los defaults a nivel de presentación que se heredan en todos los slides:

```javascript
presentation.meta.set({
  dimensions: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  defaultFont: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
  defaultColors: { background: '#0f172a', text: '#f8fafc', accent: '#3b82f6' },
});
```

Presets de temas incluidos:

| Nombre | Fondo | Acento | Ideal para |
| --- | --- | --- | --- |
| `dark-professional` | `#0f172a` | `#3b82f6` | Tech, decks de inversores |
| `light-minimal` | `#ffffff` | `#2563eb` | Formal, académico |
| `startup` | `#18181b` | `#f97316` | Pitch decks, demo days |
| `executive` | `#1a1a2e` | `#c9a227` | Reuniones de directorio, revisiones anuales |
| `technical` | `#1e1e2e` | `#89b4fa` | Charlas técnicas, arquitectura |
| `creative` | `#0d0d0d` | `#ff3366` | Portfolios de diseño, pitches de marca |

Aplicá un preset por nombre al crear:

```javascript
await sdk.slides.create({ title: 'Mi Deck', theme: 'dark-professional', slides: [ /* … */ ] });
```

O aplicalo en una presentación abierta:

```javascript
presentation.meta.set({
  defaultFont: { heading: 'Playfair Display', body: 'Source Sans Pro', mono: 'Source Code Pro' },
  defaultColors: { background: '#1a1a2e', text: '#eaeaea', accent: '#c9a227' },
});
```

Un slide puede sobrescribir cualquier propiedad en cascada sin afectar a los demás:

```javascript
presentation.slides.update('slide-5', {
  overrides: {
    background: '#ffffff',
    font: { heading: 'Playfair Display' },
  },
});
```

## Helpers de layout

`sdk.slides.helpers` devuelve strings HTML. Usálos tal cual o componélos con tu propio markup.

### Fragmentos de contenido

```typescript
helpers.textBlock(content: string, style?: TextStyle): string
helpers.image(blobId: string, options?: ImageOptions): string
helpers.codeBlock(code: string, language: string): string
helpers.chart(config: ChartConfig): string
helpers.embed(url: string, options?: EmbedOptions): string
helpers.video(blobId: string, options?: VideoOptions): string
```

Ejemplo:

```javascript
const img = sdk.slides.helpers.image(blobId, {
  width: '60%',
  align: 'center',
  caption: 'Ingresos Q4 por región',
});
presentation.slides.setContent(slide.id, img);
```

### Helpers de layout completo de slide

Los helpers de layout devuelven un cuerpo completo de slide posicionado. Cada uno acepta un objeto de slots — no tenés que escribir flex o grid para los patrones comunes.

```typescript
helpers.layout.title({ title, subtitle?, eyebrow?, logo? }): string
helpers.layout.section({ number?, title, subtitle? }): string
helpers.layout.titleContent({ title, body }): string
helpers.layout.twoCol({ title?, left, right }): string
helpers.layout.imageText({ image, title, body, side?: 'left' | 'right' }): string
helpers.layout.fullImage({ src, caption? }): string
helpers.layout.bigStat({ value, label, context? }): string
helpers.layout.quote({ text, author?, role? }): string
helpers.layout.cards({ title?, cards: { icon?, title, body }[] }): string
helpers.layout.chart({ title?, chart, insight? }): string
helpers.layout.blank(html: string): string
```

Los slots aceptan texto plano o HTML de helpers anidados:

```javascript
presentation.slides.setContent(slide.id,
  sdk.slides.helpers.layout.titleContent({
    title: 'Hallazgos clave',
    body: sdk.slides.helpers.textBlock('Ingresos aumentaron 47% interanual.'),
  })
);
```

## Crear con contenido

Pasá slides directamente a `sdk.slides.create()` para crear un deck completo en una sola llamada:

```javascript
const result = await sdk.slides.create({
  title: 'Revisión Q4',
  theme: 'dark-professional',
  slides: [
    { layout: 'title',   title: 'Revisión Q4', subtitle: '2026' },
    { layout: 'bigStat', value: '+47%', label: 'Crecimiento interanual' },
    { layout: 'cards',   cards: [
      { title: 'Ingresos', body: 'ARR $4.2M' },
      { title: 'Clientes', body: '1.200 activos' },
      { title: 'NPS', body: '72' },
    ]},
    { html: '<div class="custom">Slide personalizado</div>' },  // escape hatch
  ],
});
```

Cada ítem en `slides` es un `SlideSpec`:

```typescript
type SlideSpec =
  | { layout: string; [slot: string]: unknown; notes?: string; hidden?: boolean }
  | { html: string; notes?: string; hidden?: boolean }
```

El SDK resuelve `layout` a la llamada `helpers.layout.*` correspondiente antes de escribir el contenido, de modo que el servidor siempre recibe HTML.

## Operaciones masivas en presentaciones abiertas

```typescript
p.slides.addMany(slides: SlideSpec[]): Promise<Slide[]>
p.slides.replaceAll(slides: SlideSpec[]): Promise<Slide[]>
```

Ambas usan el endpoint batch (`POST /data/slides/{id}/slides/batch`) — una escritura atómica en el servidor independientemente de la cantidad de slides.

```javascript
await presentation.slides.replaceAll([
  { layout: 'title', title: 'Deck actualizado' },
  { layout: 'titleContent', title: 'Agenda', body: '...' },
]);
```

## Input desde Markdown

Convertí un outline Markdown en slide specs:

```javascript
const specs = sdk.slides.helpers.fromMarkdown(`
# Revisión Q4

## Ingresos
- ARR $4.2M
- Subió 47% interanual

## Clientes
- 1.200 cuentas activas
`);

await sdk.slides.create({ title: 'Revisión Q4', slides: specs });
```

La transformación divide en `---` o encabezados de primer nivel, mapea `#` al layout `title` y `##` al layout `titleContent`.

## Generación con IA

Generá un deck completo desde un prompt — el layout de slides, el copy y la estructura los produce el LLM del servidor:

```javascript
const result = await sdk.slides.generate({
  prompt: 'Pitch de inversión para una empresa SaaS B2B enfocada en visibilidad de cadena de suministro',
  theme: 'dark-professional',
  length: 12,  // cantidad objetivo de slides (opcional)
});
// Devuelve el mismo CreateResult que sdk.slides.create()
```

Devuelve 503 si no hay proveedor de IA configurado, 502 si el modelo emite output inválido.

## IA por slide

Refiná slides individuales después de crear el deck:

```javascript
// Reescribir el contenido de un slide según una instrucción
await presentation.slides.rewrite('slide-3', 'Hacélo más conciso — máximo dos bullets');

// Expandir contenido
await presentation.slides.expand('slide-5', 'Agregá una tabla comparativa');

// Generar notas del presentador para un slide
const notes = await presentation.slides.generateNotes('slide-2');

// Obtener sugerencias de layout (solo lectura, no aplica cambios)
const suggestion = await presentation.slides.suggestLayout('slide-4');
```

## Transacciones y deshacer

Agrupá múltiples cambios en un solo paso de deshacer:

```javascript
presentation.transact(() => {
  const slide = presentation.slides.add();
  presentation.slides.setContent(slide.id, '<h1>Título</h1>');
  presentation.speakerNotes.set(slide.id, 'Notas acá');
});
// Los tres cambios = 1 paso de deshacer

presentation.undo.undo();
presentation.undo.redo();
```

## Notas del presentador

Las notas se almacenan como Y.Text — colaborativas y renderizadas en Markdown en la vista del presentador:

```javascript
presentation.speakerNotes.set('slide-1', `
# Puntos clave
- Ingresos subieron 15%
- Nuevos clientes: 1.200
- Mencionar comparación con Q3
`);

// Observar notas mientras los colaboradores las editan
const notes = presentation.speakerNotes.get('slide-3');
notes.observe(() => renderMarkdown(notes.toString()));
```
