---
title: Modo presentador
description: Vista del presentador, navegación, puntero láser, temporizadores y sincronización de audiencia en ShareOut Slides.
---

El modo presentador provee un sistema de dos vistas: el presentador tiene una vista del presentador con notas, temporizadores y controles de navegación; la audiencia ve el slide actual sincronizado. Solo un presentador puede estar activo a la vez.

## Iniciar una presentación

```javascript
await presentation.presenter.start({
  fromSlide: 0,       // índice de slide (default: 0)
  countdown: 1800,    // cuenta regresiva de 30 minutos en segundos (opcional)
});
```

Opciones completas:

```typescript
interface StartOptions {
  fromSlide?: number;
  countdown?: number;
  autoAdvance?: boolean;
  autoAdvanceInterval?: number;  // segundos entre avances automáticos
}
```

Llamar a `start()` establece `presentationState.isPresenting = true` en el documento Y.js. Todos los clientes conectados reciben la actualización de inmediato.

## Navegación

```javascript
presentation.presenter.next();
presentation.presenter.previous();
presentation.presenter.first();
presentation.presenter.last();
presentation.presenter.goToSlide(5);   // índice base cero
```

Los slides con `hidden: true` se saltean automáticamente durante `next()` y `previous()`.

Atajos de teclado sugeridos para una UI personalizada del presentador:

| Tecla | Acción |
| --- | --- |
| `→` `Espacio` `Enter` | Slide siguiente |
| `←` `Backspace` | Slide anterior |
| `Home` | Primer slide |
| `End` | Último slide |
| `L` | Activar/desactivar láser |
| `B` | Activar/desactivar blackout |
| `Esc` | Finalizar presentación |

## Vista del presentador

La vista del presentador típicamente muestra: preview del slide actual, miniatura del próximo slide, notas del presentador, temporizador y contador de slides. Construíla a partir del estado que devuelve `subscribe()`:

```javascript
presentation.presenter.subscribe(state => {
  updateSlideCounter(state.currentSlideIndex, state.totalSlides);
  updateTimer(state);
  if (state.countdown) {
    const { remaining } = state.countdown;
    setTimerColor(remaining > 300 ? 'green' : remaining > 60 ? 'yellow' : 'red');
  }
});
```

### Leer las notas del presentador

Las notas son Markdown. Renderizálas en el panel del presentador para el slide actual:

```javascript
const currentSlideId = presentation.slides.list()[state.currentSlideIndex]?.id;
const notes = presentation.speakerNotes.get(currentSlideId);
notesPanel.innerHTML = renderMarkdown(notes.toString());

notes.observe(() => {
  notesPanel.innerHTML = renderMarkdown(notes.toString());
});
```

## Temporizador

```typescript
timer.elapsed(): number              // segundos desde que empezó la presentación
timer.slideElapsed(): number         // segundos en el slide actual
timer.setCountdown(seconds: number): void
timer.remaining(): number | null     // null si no se configuró cuenta regresiva
timer.pause(): void
timer.resume(): void
timer.reset(): void
```

Ejemplo — mostrar un reloj en vivo y cuenta regresiva:

```javascript
setInterval(() => {
  const elapsed = presentation.presenter.timer.elapsed();
  const remaining = presentation.presenter.timer.remaining();

  elapsedEl.textContent = formatSeconds(elapsed);
  if (remaining !== null) countdownEl.textContent = formatSeconds(remaining);
}, 1000);
```

Convenciones de color del temporizador:

| Tiempo restante | Indicador |
| --- | --- |
| > 5 min | Verde |
| 1–5 min | Amarillo |
| < 1 min | Rojo (parpadeando) |

## Puntero láser

La posición del láser se transmite a todos los clientes de la audiencia como coordenadas normalizadas (0–1).

```javascript
// Habilitar láser
presentation.presenter.laser.enable();

// Seguir el mouse en el elemento del slide actual del presentador
currentSlideEl.onmousemove = (e) => {
  if (!presentation.presenter.laser.isEnabled()) return;
  const rect = currentSlideEl.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  presentation.presenter.laser.move(x, y);
};

// Deshabilitar
presentation.presenter.laser.disable();
```

Renderizado en el lado de la audiencia:

```javascript
presentation.presenter.subscribe(state => {
  if (state.laser.enabled && state.laser.position) {
    const { x, y } = state.laser.position;
    laserEl.style.left = `${x * 100}%`;
    laserEl.style.top = `${y * 100}%`;
    laserEl.style.display = 'block';
  } else {
    laserEl.style.display = 'none';
  }
});
```

## Blackout

Ocultá temporalmente la vista de la audiencia (útil para pausas o preguntas):

```javascript
presentation.presenter.blackout(true);    // la audiencia ve pantalla negra
presentation.presenter.blackout(false);   // reanudar
```

## Sincronización de audiencia

Los clientes de la audiencia se suscriben al estado del presentador y siguen el slide actual. No necesitan llamar a `start()`:

```javascript
presentation.presenter.subscribe(state => {
  if (!presentation.presenter.isPresenter()) {
    goToSlide(state.currentSlideIndex);
    renderLaser(state.laser);
    if (state.blackout) showBlackout();
  }
});
```

Para verificar si alguien está presentando actualmente:

```javascript
presentation.presenter.isActive();      // true si hay una presentación en curso
presentation.presenter.isPresenter();   // true si este cliente es el presentador
```

### Autonavegación opcional de la audiencia

Si nadie está presentando, o si el presentador lo habilita, los viewers pueden navegar de forma independiente:

```javascript
// Configurar en la presentación para permitir navegación de la audiencia
presentation.meta.set({ allowAudienceNavigation: true });
```

## Finalizar una presentación

```javascript
presentation.presenter.stop();
// Limpia presentationState.isPresenting
// La audiencia vuelve a la vista normal
// Los datos de timing por slide se guardan en el map timings
```

## Transferir el control al presentador

Solo un usuario puede presentar a la vez. Para transferir:

```javascript
// Presentador actual
presentation.presenter.stop();

// Nuevo presentador (cliente separado)
await presentation.presenter.start();
```

## Referencia de estado

Objeto de estado completo devuelto por `presenter.state()` y `presenter.subscribe()`:

```typescript
interface PresentationState {
  isPresenting: boolean;
  presenterId: string | null;
  presenterName: string | null;
  currentSlideIndex: number;
  totalSlides: number;
  startedAt: number | null;        // timestamp unix ms
  slideStartedAt: number | null;
  countdown: {
    total: number;
    remaining: number;
    paused: boolean;
  } | null;
  laser: {
    enabled: boolean;
    position: { x: number; y: number } | null;
  };
  blackout: boolean;
}
```

## Historial de versiones

Creá una versión con nombre antes de presentar para que el rollback sea seguro:

```javascript
await presentation.versions.create('Antes de la reunión de directorio', 'Backup pre-presentación');
```

Después de presentar, comparás qué cambió:

```javascript
const diff = await presentation.versions.diff('ver_antes', 'ver_despues');
console.log(`${diff.slides.modified.length} slides modificados`);
```

API completa de versiones:

```typescript
versions.list(): Promise<Version[]>
versions.create(name: string, description?: string): Promise<Version>
versions.restore(versionId: string): Promise<void>    // auto-guarda el estado actual primero
versions.diff(fromId: string, toId: string): Promise<VersionDiff>
versions.delete(versionId: string): Promise<boolean>
versions.subscribe(handler: (versions: Version[]) => void): () => void
```

Los auto-saves se activan: cada 5 minutos si hay cambios, antes de iniciar una presentación, y cuando el último editor se desconecta. Se conservan los últimos 10 auto-saves; las versiones con nombre nunca se eliminan automáticamente.

## Permisos

| Rol | Puede presentar | Puede ver publicada | Puede editar |
| --- | --- | --- | --- |
| `owner` | Sí | Sí | Sí |
| `editor` | Sí | Sí | Sí |
| `viewer` | No | Sí | No |
| Anónimo | No | Según visibilidad | No |

Gestioná colaboradores via `sdk.collaborators`:

```javascript
await sdk.collaborators.add(['colega@ejemplo.com'], 'editor');
await sdk.collaborators.add(['stakeholder@ejemplo.com'], 'viewer');
```

## Publicar el link compartible

La URL publicada (`shareout.site/p/{slug}`) está siempre disponible para la audiencia. Controlá la visibilidad y el embedding:

```javascript
presentation.publish.setVisibility('public');  // 'private' | 'workspace' | 'public'
const url = presentation.publish.getUrl();
```

Embeber en una página externa:

```html
<iframe src="https://shareout.site/embed/mi-deck/" width="100%" height="600" frameborder="0"></iframe>
```

El embedding está disponible para presentaciones `public`. Restringí a orígenes específicos via `PATCH /v1/artifacts/{id}` con `embed_origins`.

(`unlisted` es un alias legacy retirado, aún aceptado en la API y tratado como `public`.)
