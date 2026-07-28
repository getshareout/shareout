---
title: Referencia de componentes y clases
description: Cada clase CSS so-* y la API JavaScript de ShareOutUI para toasts, modales, tabs, dropdowns y colores para gráficos.
---

Todas las clases tienen el prefijo `so-`. Cargá `shareout.css` primero. Para componentes interactivos (tabs, dropdowns, toasts, modales), cargá también `shareout-ui.js`.

```html
<link rel="stylesheet" href="https://shareout.site/sdk/shareout.css">
<script src="https://shareout.site/sdk/shareout-ui.js" defer></script>
```

Ver [Panorama del sistema UI](/es/ui/overview/) para el contexto completo del sistema de diseño y las reglas de integración con el editor.

---

## Layout

```html
<div class="so-container">…</div>                  <!-- centrado, máx. 1080 px -->
<div class="so-container so-container-narrow">…</div>  <!-- 640 px -->
<div class="so-container so-container-wide">…</div>    <!-- 1280 px -->

<main class="so-page"
      data-shareout-page="home"
      data-shareout-page-title="Inicio">…</main>   <!-- padding de página + outline del editor -->
<section class="so-section">…</section>            <!-- espaciado de sección + divisor -->

<div class="so-stack">…</div>                      <!-- flex vertical, gap -->
<div class="so-row">…</div>                        <!-- flex horizontal, centrado -->
<div class="so-row-between">…</div>                <!-- fila space-between -->

<div class="so-grid">…</div>                       <!-- grilla auto-fit responsiva -->
<div class="so-grid so-grid-3">…</div>             <!-- cols fijas 2/3/4, 1 col en móvil -->

<header class="so-header">
  <span class="so-header-title">Mi App</span>
  <button class="so-btn so-btn-primary">Publicar</button>
</header>

<div class="so-empty">
  <div class="so-empty-title">Sin páginas todavía</div>
  <p class="so-empty-text">Creá tu primera página para compartir.</p>
  <button class="so-btn so-btn-primary">Crear página</button>
</div>
```

---

## Botones

```html
<button class="so-btn so-btn-primary">Acción principal</button>
<button class="so-btn so-btn-secondary">Secundario</button>
<button class="so-btn so-btn-ghost">Terciario</button>
<button class="so-btn so-btn-icon" aria-label="Ajustes">⚙️</button>
<button class="so-btn so-btn-primary" disabled>Deshabilitado</button>
```

Usá `.so-btn-icon` solo para controles menores — siempre agregá `aria-label`. Un solo `.so-btn-primary` por pantalla.

---

## Inputs

```html
<div class="so-field">
  <label class="so-label" for="name">Tu nombre</label>
  <input class="so-input" id="name" type="text" placeholder="Jane Smith">
  <span class="so-hint">Aparece en tu página pública</span>
</div>

<div class="so-field">
  <label class="so-label" for="msg">Mensaje</label>
  <textarea class="so-textarea" id="msg"></textarea>
</div>

<select class="so-select"><option>Opción</option></select>

<!-- estado de error -->
<input class="so-input so-error" value="malo@">
<span class="so-error-message">Ingresá un email válido</span>
```

---

## Cards

```html
<div class="so-card">
  <h3 class="so-card-title">Ingresos</h3>
  <p>Contenido de la card.</p>
</div>

<!-- card clickeable con efecto hover -->
<a class="so-card so-card-interactive" href="…">
  <h3 class="so-card-title">Abrir reporte →</h3>
</a>
```

---

## Badges

```html
<span class="so-badge">Default</span>
<span class="so-badge so-badge-primary">Nuevo</span>
<span class="so-badge so-badge-success">Live</span>
<span class="so-badge so-badge-warning">Borrador</span>
<span class="so-badge so-badge-error">Fallido</span>
```

---

## Tablas

```html
<table class="so-table">
  <thead>
    <tr><th>Nombre</th><th>Estado</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>Reporte A</td>
      <td><span class="so-badge so-badge-success">Live</span></td>
    </tr>
  </tbody>
</table>
```

---

## Stats y KPIs

```html
<div class="so-grid so-grid-3">
  <div class="so-stat">
    <div class="so-stat-value"
         data-shareout-binding="json:totalViews">1.284</div>
    <div class="so-stat-label">Vistas totales</div>
  </div>
</div>

<div class="so-kpi">
  <div class="so-kpi-label">Ingresos</div>
  <div class="so-kpi-value"
       data-shareout-binding="json:revenue"
       data-shareout-format="currency">$12.480</div>
  <div class="so-kpi-delta so-up">▲ 12% vs mes anterior</div>
</div>
```

Agregá `data-shareout-binding` para que el panel de datos del editor rastree estos valores.

---

## Markup interactivo (estilos acá, comportamiento en shareout-ui.js)

Los tabs y dropdowns se inicializan automáticamente al cargar la página. Usá `data-so-*` para dropdowns/toasts/modales; usá `data-shareout-*` para tabs (los mismos atributos alimentan el outline del editor).

### Tabs

```html
<div data-shareout-tabs="views">
  <div class="so-tabs">
    <button class="so-tab so-active"
            data-shareout-tab="t1"
            data-shareout-tab-title="Resumen"
            aria-controls="t1">Resumen</button>
    <button class="so-tab"
            data-shareout-tab="t2"
            data-shareout-tab-title="Detalles"
            aria-controls="t2">Detalles</button>
  </div>
  <div class="so-tab-panel" id="t1">Contenido del resumen</div>
  <div class="so-tab-panel" id="t2" hidden>Contenido de detalles</div>
</div>
```

Los atributos `data-shareout-tab` sirven para dos cosas: `shareout-ui.js` conecta el cambio de tab, y el editor usa los mismos atributos para el outline de la página.

### Dropdown

```html
<div class="so-dropdown">
  <button class="so-btn so-btn-secondary" data-so-toggle>Menú ▾</button>
  <div class="so-dropdown-menu">
    <button class="so-dropdown-item">Editar</button>
    <button class="so-dropdown-item">Eliminar</button>
  </div>
</div>
```

---

## API JavaScript de ShareOutUI

Todo está en `window.ShareOutUI`. Sin build step, sin dependencias.

### Toast

```javascript
ShareOutUI.toast('¡Guardado!');
ShareOutUI.toast('No se pudo guardar', { type: 'error' });
ShareOutUI.toast('Atención', { type: 'warning', duration: 5000 });
```

Tipos: `success` | `warning` | `error`. Los toasts se apilan en el centro inferior y se descartan automáticamente después de 3 s.

### Modal

```javascript
ShareOutUI.modal(
  '<h3 class="so-card-title">Confirmar</h3><p>¿Eliminar esta página?</p>' +
  '<div class="so-row">' +
    '<button class="so-btn so-btn-secondary" onclick="ShareOutUI.closeModal()">Cancelar</button>' +
    '<button class="so-btn so-btn-primary">Eliminar</button>' +
  '</div>'
);

ShareOutUI.closeModal(); // también se cierra con clic en el backdrop o Escape
```

Pasá un string HTML o un nodo del DOM.

### Copiar al portapapeles

```javascript
const ok = await ShareOutUI.copy('https://shareout.site/a/my-page');
if (ok) ShareOutUI.toast('Link copiado');
```

### Colores para gráficos

Devuelve la paleta de series con la marca correcta (`--so-chart-1` … `8`) para cualquier librería de gráficos:

```javascript
const colors = ShareOutUI.chartColors(); // ['#2563eb', '#16a34a', ...]

new Chart(ctx, {
  type: 'bar',
  data: { labels, datasets: [{ data, backgroundColor: colors }] }
});
```

### Re-inicializar después de cambios dinámicos en el DOM

```javascript
container.innerHTML = newMarkup;
ShareOutUI.init(container); // o ShareOutUI.init() para todo el documento
```

Llamalo después de inyectar tabs o dropdowns via JavaScript.

### Resumen de la API

| Método | Propósito |
|---|---|
| `ShareOutUI.toast(msg, opts?)` | Notificación transitoria |
| `ShareOutUI.modal(htmlOrNode)` | Abrir un modal |
| `ShareOutUI.closeModal()` | Cerrar el modal abierto |
| `ShareOutUI.copy(text)` | Copiar al portapapeles → `Promise<boolean>` |
| `ShareOutUI.chartColors()` | Paleta de gráficos de marca → `string[]` |
| `ShareOutUI.init(root?)` | (Re)inicializar tabs y dropdowns |
