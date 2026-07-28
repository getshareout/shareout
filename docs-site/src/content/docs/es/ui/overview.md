---
title: Componentes UI — panorama general
description: El sistema de diseño so-c-* — fuentes de marca, tokens y clases de componentes para artifacts de ShareOut sin CSS personalizado.
---

ShareOut incluye una stylesheet y un script de comportamiento que convierten HTML plano en páginas accesibles y con la marca correcta. Enlazá la stylesheet, agregá clases `.so-` y tu artifact se ve bien sin escribir una sola línea de CSS.

## Cargarlo

```html
<head>
  <link rel="stylesheet" href="https://shareout.site/sdk/shareout.css">
  <!-- solo si necesitás toasts, modales, tabs o dropdowns: -->
  <script src="https://shareout.site/sdk/shareout-ui.js" defer></script>
</head>
```

La stylesheet trae las fuentes de marca (Satoshi, Source Sans 3, JetBrains Mono), tokens de diseño como custom properties de CSS, una capa base sin clases y todas las clases de componentes. El script expone `window.ShareOutUI` para componentes interactivos.

## La capa base sin clases

Una vez que enlazás la stylesheet, el HTML sin estilar ya se ve con la marca correcta. Los headings, el texto del cuerpo, `code` y los links usan automáticamente las fuentes y colores de marca. Solo agregás clases para los componentes.

```html
<body>
  <main class="so-container so-page">
    <h1>Informe Trimestral</h1>
    <p>El markup plano ya tiene estilos.</p>
    <button class="so-btn so-btn-primary">Empezar</button>
  </main>
</body>
```

## Usarlo con el editor en vivo

El sistema de diseño y el editor en vivo son dos capas separadas sobre el mismo markup — necesitás ambas.

- **Las clases `.so-`** controlan cómo se ve el artifact. El editor nunca elimina tags externos `<link>` o `<script>`, y las clases sobreviven cada round-trip de guardado.
- **Los atributos `data-shareout-*`** le dicen al editor qué puede ver y editar. Una página con estilos perfectos pero sin manifest ni bindings se abre con paneles vacíos y sin outline.

Todo artifact construido con el sistema de diseño debe seguir también la [especificación HTML](/es/guides/html-spec/):

- `<script type="shareout/manifest">` en `<head>` declarando cada fuente de datos.
- `data-shareout-page` en cada contenedor de página.
- `data-shareout-binding` en cada elemento que muestra datos dinámicos — combinalo sobre el mismo elemento `.so-`.

Esqueleto listo para el editor:

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <script type="shareout/manifest">
  {
    "version": "2.0",
    "sources": {
      "json": { "revenue": { "default": 0 } }
    }
  }
  </script>

  <link rel="stylesheet" href="https://shareout.site/sdk/shareout.css">
  <script src="https://shareout.site/sdk/shareout-ui.js" defer></script>
  <script src="https://shareout.site/sdk/shareout.js"></script>
</head>
<body>
  <main class="so-container so-page"
        data-shareout-page="home"
        data-shareout-page-title="Inicio">
    <h1>Informe trimestral</h1>

    <div class="so-grid so-grid-3">
      <div class="so-stat">
        <div class="so-stat-value"
             data-shareout-binding="json:revenue"
             data-shareout-format="currency">$0</div>
        <div class="so-stat-label">Ingresos</div>
      </div>
    </div>

    <button class="so-btn so-btn-primary">Publicar</button>
  </main>
</body>
</html>
```

## Tokens de diseño

Todos los tokens son custom properties de CSS — preferílos sobre valores hardcodeados:

| Grupo | Ejemplos |
|---|---|
| Color | `--so-color-primary`, `--so-color-bg`, `--so-color-text`, `--so-color-text-secondary`, `--so-color-border`, `--so-color-success`, `--so-color-warning`, `--so-color-error` |
| Espaciado (base 8 px) | `--so-space-1` … `--so-space-32` |
| Radio | `--so-radius-sm` (12 px) … `--so-radius-xl` (24 px), `--so-radius-full` |
| Tipografía | `--so-text-xs` … `--so-text-4xl`, `--so-font-display` / `-body` / `-mono`, `--so-weight-medium` / `-semibold` / `-bold` |
| Sombra | `--so-shadow-sm` … `--so-shadow-xl` |
| Gráficos | `--so-chart-1` … `--so-chart-8` (paleta de series con la marca correcta) |

## Reglas

- **No inventés CSS** para cosas que el sistema de diseño ya cubre — botones, cards, inputs, badges, tablas, stats, layout. Usá clases `.so-`.
- **No uses fuentes genéricas** como Inter o Roboto, ni gradientes violetas ni temas oscuros tipo "IA". La stylesheet incluye las fuentes correctas de marca y una paleta cálida y clara.
- **Referenciá tokens, no hardcodees.** Usá `var(--so-color-primary)` en vez de valores hex directos.
- **Una acción primaria por pantalla.** Usá `.so-btn-primary` una vez; todo lo demás es `.so-btn-secondary` o `.so-btn-ghost`.

## Cuándo usarlo

Usá el sistema de diseño de ShareOut para cualquier artifact HTML por defecto. Solo evitalo cuando el usuario pide explícitamente un look completamente personalizado — por ejemplo, un portal de cliente que debe coincidir con un sistema de marca externo.

## Próximos pasos

- [Referencia de componentes y clases](/es/ui/components/) — cada clase `.so-` con ejemplos HTML, más la API JavaScript de `ShareOutUI`.
