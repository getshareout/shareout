---
title: Mobile y PWA — panorama general
description: Convertí cualquier artifact de ShareOut en una app móvil con detección de dispositivo, gestos táctiles e instalación PWA opcional.
---

Los artifacts de ShareOut son responsivos por defecto. Agregá `mobile_html` y `pwa` en tu llamada a `sdk.publish()` y obtenés detección automática de dispositivo, navegación tipo app, soporte offline y un prompt de "Agregar a la pantalla de inicio" — sin pipeline de build separado.

## Web vs. mobile

| | HTML responsivo | ShareOut Mobile |
|---|---|---|
| Agregar a la pantalla de inicio | Favorito del navegador | Ícono nativo + splash |
| Modo pantalla completa | Siempre muestra la barra de URL | Sin chrome del navegador |
| Soporte offline | Requiere conexión | Caché con service worker |
| Gestos táctiles | Scroll básico | Swipe, pull-to-refresh |
| Navegación | Solo links | Tabs inferiores, stack, drawer |
| Transiciones | Recargas de página | Animaciones nativas |

## Cómo funciona la detección de dispositivo

Publicás un solo artifact con ambas versiones. ShareOut sirve la correcta automáticamente:

| User agent | Versión servida |
|---|---|
| Navegador de escritorio | `html` |
| Navegador móvil | `mobile_html` (si está definido) |
| Tablet | `html` por defecto |

Podés forzarlo con `?v=web` o `?v=mobile`.

## Publicar ambas versiones

```javascript
const sdk = new ShareOut();

await sdk.publish({
  slug: 'my-app',
  title: 'My App',
  html: webHtml,          // se sirve en escritorio
  mobile_html: mobileHtml // se sirve en navegadores móviles
});
```

Agregá la key `pwa` para hacer el artifact instalable — ver [Configuración PWA](/es/mobile/pwa/).

## Patrones de navegación

El SDK móvil (`shareout-mobile.js`) incluye tres estilos de navegación:

**Bottom tabs** — navegación principal, al alcance del pulgar:

```javascript
ShareOut.mobile.navigation({ type: 'bottom-tabs', tabs: [
  { id: 'home',    icon: 'home',   label: 'Inicio' },
  { id: 'search',  icon: 'search', label: 'Buscar' },
  { id: 'profile', icon: 'user',   label: 'Perfil' }
], onChange: tabId => showView(tabId) });
```

**Stack** — push/pop de pantallas con transiciones animadas:

```javascript
ShareOut.mobile.navigation({ type: 'stack', initialView: 'list' });
ShareOut.mobile.push('detail', { id: 123 });
ShareOut.mobile.pop();
```

**Drawer** — menú lateral deslizable:

```javascript
ShareOut.mobile.navigation({ type: 'drawer', position: 'left', items: [
  { id: 'dashboard', icon: 'grid', label: 'Dashboard' },
  { id: 'settings',  icon: 'cog',  label: 'Ajustes' }
] });
```

## Interacciones táctiles

```javascript
// Swipe entre vistas
ShareOut.mobile.swipe({ element: '#main',
  onSwipeLeft:  () => showNextView(),
  onSwipeRight: () => showPrevView()
});

// Pull to refresh
ShareOut.mobile.pullToRefresh({ element: '#content',
  onRefresh: async () => fetchNewData()
});

// Feedback háptico
ShareOut.mobile.haptic('success'); // light | medium | heavy | success | error
```

## Principios de diseño

- **Thumb-first** — las acciones principales en el 60 % inferior de la pantalla.
- **Targets táctiles ≥ 48 × 48 px** — usá padding para agrandar íconos pequeños.
- **Contenido > chrome** — barras de navegación delgadas; el contenido domina.
- **Feedback inmediato** — highlight táctil en < 100 ms, spinner después de 300 ms.
- **Offline-first** — mostrá datos en caché y un banner cuando se corta la conexión.
- **Respetá las preferencias del sistema** — `prefers-color-scheme`, `prefers-reduced-motion`.

## Cuándo usar mobile_html

Agregá un `mobile_html` separado cuando:

- La navegación necesita moverse al fondo de la pantalla.
- Las cards deben apilarse verticalmente en vez de en grilla.
- Querés gestos de swipe o pull-to-refresh.
- El layout de escritorio usa hover states o sidebars anchas.

Un único layout responsivo es suficiente para reportes y dashboards de solo lectura que se reorganizan bien en pantallas angostas.

## Soporte de navegadores

| Feature | iOS Safari | Chrome Android | Samsung Internet |
|---|---|---|---|
| Instalación PWA | 14+ | 72+ | 12+ |
| Service worker | 11.3+ | 45+ | 4+ |
| Web App Manifest | 11.3+ | 39+ | 4+ |
| Feedback háptico | 13+ | 89+ | Limitado |
| Fullscreen API | 12+ | 38+ | 4+ |

## Próximos pasos

- [Configuración PWA](/es/mobile/pwa/) — manifest, caché offline, install prompt, íconos.
- [Referencia del SDK](/es/sdk/json/) — los data stores funcionan igual en modo PWA.
