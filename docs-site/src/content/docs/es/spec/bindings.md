---
title: Bindings
description: Conectar elementos HTML a fuentes de datos con data-shareout-binding.
---

Los bindings de datos conectan elementos HTML con las sources del manifest. Todo valor
dinámico en un artifact debe usar `data-shareout-binding` — la manipulación directa del
DOM vía JavaScript oculta los valores del panel de datos del editor y el rastreador de
variables.

## Sintaxis

```
data-shareout-binding="TYPE:PATH"
```

## Tipos de binding

| Tipo | Sintaxis | Ejemplo |
|------|--------|---------|
| Key JSON | `json:key` | `json:settings.theme` |
| JSON anidado | `json:key.path.to.value` | `json:metrics.revenue.total` |
| Campo de fila de tabla | `table:name:row:$id:field` | `table:tasks:row:$id:title` |
| Fila con ID estático | `table:name:row:ID:field` | `table:tasks:row:task-1:title` |
| Count de tabla | `table:name:count:field` | `table:tasks:count:id` |
| Count filtrado | `table:name:count:field:filter` | `table:tasks:count:id:done=true` |
| Sum de tabla | `table:name:sum:field` | `table:orders:sum:amount` |
| Avg de tabla | `table:name:avg:field` | `table:orders:avg:amount` |
| Computed | `computed:name` | `computed:completedCount` |

## Ejemplo básico

```html
<!-- CORRECTO: el editor rastrea este binding -->
<span data-shareout-binding="json:metrics.revenue"
      data-shareout-format="currency"
      data-shareout-display="Total Revenue">$0</span>

<!-- INCORRECTO: oculto al editor -->
<span id="revenue"></span>
<script>document.getElementById('revenue').textContent = await sdk.json.get('metrics.revenue')</script>
```

## Atributo de formato

Aplicá un formato de visualización con `data-shareout-format`:

```html
<span data-shareout-binding="json:metrics.revenue"
      data-shareout-format="currency">$0</span>
```

| Formato | Parámetros | Ejemplo de salida |
|---------|------------|-------------------|
| `currency` | — | $1,234.56 |
| `percent` | — | 12.5% |
| `number` | — | 1,234 |
| `number:0` | 0 decimales | 1,235 |
| `number:2` | 2 decimales | 1,234.56 |
| `date` | — | May 29, 2026 |
| `date:short` | — | 5/29/26 |
| `date:long` | — | May 29, 2026 |
| `date:iso` | — | 2026-05-29 |
| `time` | — | 3:45 PM |
| `datetime` | — | May 29, 2026 3:45 PM |

En el modo **Inspect** de Live Studio, los elementos con binding muestran un control
**Format** (texto plano, número, moneda, porcentaje, fecha) que lee y escribe
`data-shareout-format` — no hace falta editar el atributo a mano.

## Etiqueta de display

`data-shareout-display` provee una etiqueta legible que se muestra en el panel de datos
del editor:

```html
<span data-shareout-binding="json:metrics.revenue"
      data-shareout-format="currency"
      data-shareout-display="Total Revenue">$0</span>
```

## Bindings editables

Agregá `data-shareout-editable="true"` para permitir que quienes vean el artifact editen
el valor in-place:

```html
<input data-shareout-binding="json:settings.name"
       data-shareout-editable="true"
       data-shareout-validation="string:minLength=1:maxLength=100">

<input type="number"
       data-shareout-binding="json:settings.goal"
       data-shareout-editable="true"
       data-shareout-validation="number:min=0:max=100">

<input type="checkbox"
       data-shareout-binding="table:tasks:row:$id:done"
       data-shareout-editable="true">
```

## Reglas de validación

| Regla | Sintaxis | Ejemplo |
|-------|--------|---------|
| Número | `number` | `number` |
| Número con rango | `number:min=X:max=Y` | `number:min=0:max=100` |
| String | `string` | `string` |
| String con longitud | `string:minLength=X:maxLength=Y` | `string:minLength=1:maxLength=50` |
| Email | `email` | `email` |
| URL | `url` | `url` |
| Patrón | `pattern:REGEX` | `pattern:^[A-Z]{2}[0-9]{4}$` |

## Bindings de agregados

```html
<!-- Contar todas las filas -->
<span data-shareout-binding="table:tasks:count:id">0</span>

<!-- Contar filas filtradas -->
<span data-shareout-binding="table:tasks:count:id:done=true">0</span>

<!-- Sum -->
<span data-shareout-binding="table:orders:sum:amount"
      data-shareout-format="currency">$0</span>

<!-- Average -->
<span data-shareout-binding="table:orders:avg:amount"
      data-shareout-format="currency">$0</span>
```

## Bindings de computed

Referenciá un valor declarado en `manifest.computed`:

```html
<span data-shareout-binding="computed:completedCount"
      data-shareout-display="Completed Tasks">0</span>
```

## Checklist

- Todo valor dinámico tiene `data-shareout-binding`.
- No hay `element.textContent = ` ni `innerHTML = ` sin el binding correspondiente.
- Los paths de binding coinciden con las keys y nombres de tabla declarados en el [manifest](/es/spec/manifest/).
- Los bindings editables tienen tanto `data-shareout-editable="true"` como `data-shareout-validation`.

## Relacionado

- [Manifest](/es/spec/manifest/) — declarar las sources que referencian los bindings
- [Templates](/es/spec/templates/) — bindings dentro de contenido repetitivo usan `$id` e `$index`
- [Resumen](/es/spec/overview/) — referencia completa de atributos
