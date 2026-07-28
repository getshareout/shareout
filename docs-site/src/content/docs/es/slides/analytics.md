---
title: Analítica de visualizaciones y enlaces rastreables
description: Mirá quién vio una presentación, hasta dónde llegó y dónde se detuvo — con enlaces rastreables por destinatario y alertas de apertura.
---

ShareOut Slides convierte una presentación publicada de un visor anónimo en una superficie de ventas. Cada visualización se captura automáticamente, podés enviar **enlaces rastreables y restringidos** para identificar a cada espectador, y recibís un **correo en el momento en que alguien la abre**.

## Qué obtenés

- **Captura automática** — cada presentación publicada registra sesiones de visualización sin código adicional.
- **Engagement por diapositiva** — tiempo en cada diapositiva y dónde abandonan los espectadores.
- **Enlaces rastreables** — un enlace por destinatario, opcionalmente restringido por email, contraseña o dominio.
- **Alertas de apertura** — "Acme acaba de abrir tu propuesta" enviado por correo.
- **Panel del propietario** — `/app/slides/{artifactId}/analytics`.

## La captura es automática

Abrir una presentación con `so.slides.view()` inicia la captura por sí solo — cantidad de sesiones, espectadores únicos, duración, dispositivo y país. No hace falta tocar la plantilla.

```javascript
const deck = await so.slides.view('pres_...');   // la captura ya está ACTIVA
```

Para obtener además **tiempo y abandono por diapositiva**, indicá a la presentación cuándo el espectador cambia de diapositiva:

```javascript
deck.trackSlide(index);   // llamalo desde tu manejador de navegación
```

Desactivalo con `so.slides.view(id, { track: false })`.

Privacidad: la IP del espectador se guarda con hash (nunca en crudo), `DNT: 1` suprime IP / user-agent / país, y un email solo se retiene cuando el espectador lo entrega a través de un enlace restringido.

## Enlaces rastreables y restringidos

Un enlace rastreable atribuye una sesión a un destinatario con nombre y puede exigir credenciales antes de abrir la presentación.

```javascript
// Propietario: crear un enlace por destinatario
const link = await deck.links.create({
  recipientLabel: 'Acme Corp',
  gate: 'email',            // 'none' | 'email' | 'password' | 'domain'
  maxViews: 25,             // límite opcional
  expiresAt: '2026-12-31T00:00:00.000Z', // opcional
});
// compartí link.url → https://shareout.site/p/<deck>?l=lnk_...

await deck.links.list();          // enlaces con conteo de vistas en vivo
await deck.links.revoke('lnk_...'); // se conserva la analítica de vistas previas
```

Cuando un destinatario abre un enlace, ShareOut gestiona la restricción y atribuye la sesión:

```javascript
// Sin restricción (gate: 'none') — totalmente automático, no hay que hacer nada.

// Restricción (email / contraseña) — recolectá el valor y luego:
const deck = await so.slides.view('pres_...', { track: false });
const { sessionId } = await deck.links.access('lnk_...', { email });
await deck.startTracking(sessionId);   // la sesión ahora tiene nombre
```

| Restricción | Exige antes de ver |
|------|--------------------------|
| `none` | nada — la sesión igual se atribuye al destinatario |
| `email` | un email válido (se captura como identidad del espectador) |
| `domain` | un email cuyo dominio esté en tu lista permitida |
| `password` | la contraseña que definiste (guardada con hash) |

## Alertas de apertura

Cuando un destinatario abre un enlace rastreable, se le envía un correo al propietario — por ejemplo *"Acme Corp abrió Q3 Proposal."* Las aperturas repetidas del mismo enlace se agrupan en un correo cada 30 minutos para que un refresco no genere spam. Las vistas públicas anónimas no notifican; solo las aperturas de enlaces rastreables.

## Panel del propietario

Leé todo en **`/app/slides/{artifactId}/analytics`** (solo propietario o colaborador con rol distinto de viewer):

- tarjetas resumen — vistas totales, espectadores únicos, tiempo promedio, tasa de finalización
- barras por diapositiva con sombreado de abandono
- una tabla de sesiones — espectador/email, dispositivo, país, diapositivas vistas, finalizado, cuándo
- el panel de enlaces rastreables — crear, copiar y revocar enlaces

También podés leer los mismos datos de forma programática:

```javascript
const a = await deck.analytics();
// { summary, perSlide: [{ slideIndex, views, avgDwellMs, dropOffRate }], sessions: [...] }
```
