---
title: Page Pilot
description: Agente de IA que opera la interfaz de un artifact publicado en nombre del visitante, usando instrucciones en lenguaje natural.
---

import { Aside } from '@astrojs/starlight/components';

Agregá un agente de IA que *opera la página* — hace clic en botones, completa formularios, navega tablas — a partir de una tarea en lenguaje natural del visitante. Accedé vía `so.agent.pilot()`.

<Aside type="caution">
Page Pilot está **deshabilitado por defecto**. Habilitalo por artifact desde el endpoint de admin config (owner o editor).
</Aside>

<Aside type="note">
**No es lo mismo que el agente de chat.** `so.agent.chat()` responde preguntas sobre datos. Page Pilot *opera la página*. Usá chat cuando los visitantes necesitan hacer preguntas; usá Pilot cuando necesitan ejecutar acciones de UI en múltiples pasos sin conocer los controles exactos.
</Aside>

Construido sobre la biblioteca open-source [`page-agent`](https://github.com/alibaba/page-agent) (MIT, alibaba/page-agent), vendorizada y servida de forma self-hosted en `/sdk/page-pilot.js`. Las llamadas al LLM se hacen del lado del servidor — sin clave de API en el navegador — y se cobran al workspace bajo el modo de uso `'pilot'`.

## Habilitar Page Pilot

Habilitalo por artifact desde el endpoint de admin config (owner o editor — sesión o API token):

```bash
curl -X POST "https://shareout.site/v1/data/{artifactId}/agent/admin/config" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "pilot_enabled": true }'
```

Consultá el estado actual (endpoint público, sin auth):

```bash
GET /v1/data/{artifactId}/agent/config
# La respuesta incluye: { "pilot_enabled": true }
```

El booleano `pilot_enabled` en el GET público se puede leer desde el propio JS del artifact para mostrar u ocultar la UI de Pilot según corresponda.

Las actualizaciones parciales son seguras — `PUT /agent/admin/config` fusiona los campos omitidos con la configuración existente, así que podés activar `pilot_enabled` sin reenviar cada otra clave.

## Referencia del SDK

### `so.agent.pilot(task, options?)`

Ejecuta una tarea de Pilot. Devuelve una promesa que se resuelve cuando la tarea finaliza o falla.

```javascript
const so = await ShareOut.create();

const result = await so.agent.pilot(
  'Filtrá la tabla para mostrar los pedidos pendientes de la semana pasada',
  {
    maxSteps: 15,          // Pasos permitidos (1–20; default 15; el servidor limita a 20)
    instructions: 'Este dashboard gestiona pedidos de clientes. El formulario Agregar Pedido está debajo de la tabla.',
    showPanel: true,       // Panel de progreso flotante visible para el visitante (default: true)
    maskContent: true,     // Oculta números de tarjeta y emails de lo que ve el LLM (default: true)
    onEvent: (e) => {      // Stream de eventos en tiempo real (opcional)
      // e.kind: 'status' | 'activity' | 'history'
      console.log(e.kind, e.detail);
    },
  }
);

// Forma del resultado
// {
//   success: boolean,
//   data: string,                // respuesta final del agente / resumen del resultado
//   steps: number,               // pasos ejecutados
//   usage: {
//     promptTokens: number,
//     completionTokens: number,
//     totalTokens: number,
//   }
// }
```

### `so.agent.pilot.stop()`

Cancela una ejecución de Pilot en curso.

```javascript
so.agent.pilot.stop();
```

### Tipos de eventos (`onEvent`)

| `e.kind` | `e.detail` | Cuándo se dispara |
|----------|------------|-------------------|
| `'status'` | Transición de estado del agente (`idle` → `running` → `completed` / `error` / `stopped`) | Inicio, finalización, fallo |
| `'activity'` | `{ type: 'thinking' \| 'executing' \| 'executed' \| 'retrying' \| 'error', tool?, input?, ... }` | Progreso en tiempo real durante cada paso |
| `'history'` | Log de pasos/eventos actualizado | Después de cada paso completado |

## Integración con el widget de chat

Cuando `pilot_enabled` es true, el widget de chat muestra automáticamente un toggle de modo **[Preguntar] [Hacer]**.

```javascript
so.agent.widget.mount('#chat', {
  mode: 'auto',            // 'ask' | 'do' | 'auto' (default auto — muestra el toggle cuando pilot está habilitado)
  pilot: true,             // false para forzar la desactivación de Pilot aunque pilot_enabled sea true
  pilotInstructions: 'Dashboard de pedidos. Tabla al centro, formulario Agregar Pedido abajo.',
});
```

En modo **Hacer**, el progreso de Pilot se muestra como burbujas de actividad en el hilo del chat. El botón Enviar cambia a Detener. Cuando el agente necesita input del visitante, un evento `ask_user` lo redirige al compositor.

## Guía de autoría

### Usá un DOM interactivo real

El agente detecta elementos interactivos por estilo de cursor, etiqueta HTML y atributos ARIA. Un `<div>` con apariencia de botón pero sin `role`, `tabindex` ni cursor pointer es invisible para él. Usá elementos reales:

```html
<!-- El agente puede encontrar estos -->
<button onclick="addOrder()">Agregar Pedido</button>
<select id="status-filter">...</select>
<input type="text" placeholder="Buscar pedidos">

<!-- El agente no puede encontrar estos de forma confiable -->
<div class="btn" style="cursor:pointer" onclick="addOrder()">Agregar Pedido</div>
```

Agregá `aria-label` cuando el propósito de un elemento no sea obvio por su texto.

### Marcá regiones sensibles con `data-so-private`

Cualquier elemento con `data-so-private` queda excluido de la visión del agente — el LLM nunca ve su contenido. Usalo para PII, números de tarjeta o cualquier dato con el que el visitante deba interactuar pero que no quieras exponer al modelo.

```html
<td data-so-private>4111 1111 1111 1234</td>
<span data-so-private class="user-email">alice@example.com</span>
```

`maskContent: true` en la llamada a pilot es una alternativa más amplia: redacta automáticamente patrones comunes (números de tarjeta, emails) en toda la página. `data-so-private` es más preciso y siempre preferible.

### Proporcioná `instructions` describiendo la página

El agente arranca sin conocimiento de tu layout. Un string corto de `instructions` mejora notablemente el éxito de las tareas:

```javascript
await so.agent.pilot(task, {
  instructions: `
    Dashboard de gestión de pedidos.
    Arriba: tarjetas de KPI (total de pedidos, ingresos, pendientes).
    Centro: tabla de pedidos con columnas Estado y Fecha, filtrable.
    Lateral derecho: formulario "Agregar Pedido" — campos Nombre, Producto, Cantidad, Estado.
  `,
});
```

## Límites y facturación

| Restricción | Valor |
|-------------|-------|
| Pasos máximos por llamada | 20 (aplicado por el servidor) |
| `maxSteps` por defecto | 15 |
| Control de costos | Límites por artifact (default 10 req/min, 100k tokens/día) |
| Modo de facturación | `'pilot'` en el ledger de uso de IA del workspace |
| Saldo agotado | HTTP 402 |
| Límite de rate superado | HTTP 429 |

Pilot comparte el saldo de IA del workspace con el chat de visitantes. Monitoreá el uso en `GET /v1/data/{artifactId}/agent/usage` — el modo `pilot` aparece junto a `visitor` y `admin`.

## Ejemplo mínimo

```html
<!DOCTYPE html>
<html>
<head>
  <title>Dashboard de Pedidos</title>
  <link rel="stylesheet" href="https://shareout.site/sdk/shareout.css">
  <script src="https://shareout.site/sdk/shareout.js"></script>
</head>
<body>
  <div class="so-toolbar">
    <input id="pilot-task" class="so-input" placeholder="¿Qué querés hacer?">
    <button id="run-pilot" class="so-btn so-btn-primary">Ir</button>
    <button id="stop-pilot" class="so-btn" style="display:none">Detener</button>
  </div>

  <p id="pilot-status" class="so-text-muted"></p>

  <table>
    <thead><tr><th>Pedido</th><th>Estado</th><th>Monto</th></tr></thead>
    <tbody id="orders"><!-- cargado por sdk.table --></tbody>
  </table>

  <form id="add-order-form" aria-label="Agregar Pedido">
    <input name="name" placeholder="Nombre del cliente" required>
    <select name="status">
      <option>pendiente</option><option>enviado</option><option>cerrado</option>
    </select>
    <button type="submit">Agregar Pedido</button>
  </form>

  <script>
  (async () => {
    const so = await ShareOut.create();
    const status = document.getElementById('pilot-status');
    let running = false;

    document.getElementById('run-pilot').onclick = async () => {
      const task = document.getElementById('pilot-task').value.trim();
      if (!task || running) return;

      running = true;
      document.getElementById('stop-pilot').style.display = '';
      status.textContent = 'Ejecutando…';

      const result = await so.agent.pilot(task, {
        maxSteps: 15,
        instructions: 'Dashboard de pedidos. Tabla al centro, formulario Agregar Pedido abajo.',
        showPanel: true,
        onEvent: (e) => {
          if (e.kind === 'activity' && e.detail?.tool) status.textContent = e.detail.tool;
        },
      });

      running = false;
      document.getElementById('stop-pilot').style.display = 'none';
      status.textContent = result.success ? 'Listo.' : `Error: ${result.data || 'desconocido'}`;
    };

    document.getElementById('stop-pilot').onclick = () => so.agent.pilot.stop();
  })();
  </script>
</body>
</html>
```

## Seguridad

- El agente actúa solo dentro del iframe del artifact con los permisos de sesión del **visitante** — no puede leer ni escribir otros artifacts.
- El servidor rechaza las llamadas de herramientas que soliciten ejecución arbitraria de JS.
- Las regiones con `data-so-private` se eliminan de la visión del agente antes de la llamada al LLM.
- `maskContent: true` redacta automáticamente patrones comunes de PII (números de tarjeta, emails) en toda la página.
- El saldo del workspace y los límites de pasos acotan el costo máximo por llamada.
- **Limpieza anti-inyección de prompts** del lado del servidor en el texto de mensajes user/tool (tope de 24 KB por mensaje) antes del proxy de completions — los mensajes system y assistant nunca se modifican.
- **Guardia de oscilación** del SDK detiene bucles A-B-A-B de acciones (además de tres pasos idénticos consecutivos) para que clics alternados no consuman todo el presupuesto de pasos.
