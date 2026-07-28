---
title: Configuración PWA
description: Hacé que un artifact de ShareOut sea instalable — manifest, íconos, caché offline y el prompt de instalación.
---

Cuando configurás `pwa.enabled: true` en `sdk.publish()`, ShareOut genera un Web App Manifest, registra un service worker, redimensiona tu ícono automáticamente y muestra un prompt de instalación a los visitantes elegibles. HTTPS está incluido.

## Inicio rápido

```javascript
const sdk = new ShareOut();

await sdk.publish({
  slug: 'my-app',
  title: 'My App',
  html: appHtml,
  pwa: {
    enabled: true,
    name: 'My App',
    short_name: 'MyApp',
    icon: iconBase64,         // PNG 512×512, codificado en base64
    theme_color: '#3b82f6',
    background_color: '#ffffff'
  }
});
```

ShareOut se encarga automáticamente de:

1. Crear `manifest.json` en `/a/{slug}/manifest.json`
2. Generar íconos en todos los tamaños necesarios (192, 512 y más)
3. Registrar un service worker para caché offline
4. Inyectar meta tags de iOS/Android en el HTML
5. Mostrar un prompt de instalación a los visitantes elegibles

## Todas las opciones PWA

```javascript
pwa: {
  // Requerido
  enabled: true,
  name: 'My Application',       // Nombre completo (máx. 45 chars)
  short_name: 'MyApp',          // Etiqueta en la pantalla de inicio (máx. 12 chars)
  icon: iconBase64,             // PNG 512×512

  // Apariencia
  theme_color: '#3b82f6',       // Color del chrome del navegador
  background_color: '#ffffff',  // Fondo de la splash screen
  display: 'standalone',        // standalone | fullscreen | minimal-ui | browser

  // Comportamiento
  start_url: '/',
  scope: '/',
  orientation: 'any',           // any | portrait | landscape

  // Íconos adicionales
  icons: {
    favicon: favicon16Base64,   // 16×16 para la pestaña del navegador
    apple_touch: icon180Base64, // 180×180 para iOS
    maskable: maskableIcon512   // Ícono adaptativo Android (zona segura del 80 %)
  },

  // Offline
  offline: {
    enabled: true,
    strategy: 'cache-first',    // cache-first | network-first
    cacheName: 'my-app-v1',
    assets: ['/fonts/inter.woff2', '/images/logo.png']
  },

  // Prompt de instalación
  installPrompt: {
    enabled: true,
    delay: 5000,                // ms antes de mostrar (0 = inmediato)
    text: 'Instalá para acceso rápido y uso offline',
    buttonText: 'Instalar'
  }
}
```

## Modos de display

| Modo | UI del navegador | Ideal para |
|---|---|---|
| `standalone` | Sin barra de URL | La mayoría de las apps (recomendado) |
| `fullscreen` | Sin barra de estado | Juegos, experiencias inmersivas |
| `minimal-ui` | Solo atrás/recargar | Apps que necesitan navegación |
| `browser` | Navegador completo | Contenido web estándar |

## Íconos

Proporcioná un PNG de 512 × 512. ShareOut genera todos los tamaños automáticamente:

| Tamaño | Propósito |
|---|---|
| 512 × 512 | Splash screen, alta resolución |
| 192 × 192 | Pantalla de inicio Android |
| 180 × 180 | Pantalla de inicio iOS |
| 152 × 152 | iPad |
| 32 × 32 | Favicon |
| 16 × 16 | Favicon |

Para íconos adaptativos de Android, mantené el contenido dentro del **80 % central** del canvas — el borde exterior puede ser recortado por el launcher.

## Caché offline

| Estrategia | Comportamiento | Ideal para |
|---|---|---|
| `cache-first` | Sirve desde caché; actualiza en background | Contenido estático |
| `network-first` | Intenta red; recurre a caché | Contenido dinámico |

Por defecto, ShareOut cachea el HTML, CSS/JS inline, imágenes del mismo origen y fuentes personalizadas. Agregá assets adicionales:

```javascript
offline: {
  assets: ['/api/data.json', '/fonts/custom.woff2']
}
```

Página de fallback offline personalizada:

```javascript
offline: {
  fallbackPage: '<html><body><h1>Estás offline</h1></body></html>'
}
```

## Prompt de instalación

### Prompt automático

```javascript
installPrompt: { enabled: true, delay: 5000 }
```

ShareOut muestra un banner inferior luego del delay si el navegador considera la app instalable (HTTPS + manifest válido + service worker + interacción del usuario).

### Botón de instalación personalizado

```javascript
// Dentro de mobile_html
if (ShareOut.mobile.pwa.canInstall()) {
  document.getElementById('install-btn').style.display = 'block';
}

document.getElementById('install-btn').onclick = async () => {
  const result = await ShareOut.mobile.pwa.promptInstall();
  if (result.outcome === 'accepted') ShareOutUI.toast('¡App instalada!');
};

ShareOut.mobile.pwa.onInstalled(() => {
  document.getElementById('install-btn').style.display = 'none';
});
```

### Reaccionar a cambios de estado de instalación

```javascript
ShareOut.mobile.pwa.onInstallStateChange(state => {
  // state = { canInstall: boolean, installed: boolean }
  installBtn.style.display = state.canInstall ? 'block' : 'none';
});
```

## Actualizar una PWA

Incrementá `cacheName` cada vez que publicás contenido nuevo y configurá `skipWaiting` para que el nuevo service worker se active de inmediato:

```javascript
offline: {
  cacheName: 'my-app-v2',
  skipWaiting: true
}
```

Notificá a los usuarios cuando hay una actualización disponible:

```javascript
ShareOut.mobile.pwa.onUpdateAvailable(() => {
  ShareOutUI.toast('Actualización disponible — recargá para aplicarla.', {
    type: 'warning', duration: 8000
  });
});
```

## Notas por plataforma

**iOS Safari** — la instalación requiere Compartir → "Agregar a pantalla de inicio" (sin prompt automático). ShareOut inyecta los meta tags `apple-mobile-web-app-*` necesarios. El caché del service worker está limitado a 50 MB; background sync no está disponible.

**Chrome en Android** — soporte PWA completo; el prompt de instalación se dispara automáticamente. Se puede publicar en Play Store via Trusted Web Activity (TWA).

**Samsung Internet** — soporte PWA completo via menú del navegador.

## Resumen de la API del SDK

| Método | Descripción |
|---|---|
| `ShareOut.mobile.pwa.canInstall()` | `boolean` — el prompt está disponible |
| `ShareOut.mobile.pwa.promptInstall()` | `Promise<{ outcome }>` — dispara el prompt |
| `ShareOut.mobile.pwa.isInstalled()` | `boolean` — se está ejecutando como PWA instalada |
| `ShareOut.mobile.pwa.onInstallStateChange(fn)` | Suscribirse al estado de instalación |
| `ShareOut.mobile.pwa.registerServiceWorker(path?)` | `Promise<Registration>` |
| `ShareOut.mobile.pwa.updateServiceWorker()` | Forzar chequeo de actualización |
| `ShareOut.mobile.pwa.onUpdateAvailable(fn)` | Se llama cuando hay un nuevo SW en espera |

## Testing

**Chrome DevTools** → pestaña Application → Manifest / Service Workers / Cache Storage.

**Lighthouse:**

```bash
npx lighthouse https://shareout.site/a/my-app --only-categories=pwa
```

**Simulación offline:** DevTools → Network → marcar "Offline", o Application → Service Workers → marcar "Offline".

**Simulación de instalación:** DevTools → Application → Manifest → "Add to homescreen".

## Solución de problemas

| Síntoma | Solución |
|---|---|
| El prompt de instalación no aparece | Confirmá HTTPS, manifest válido, SW registrado e interacción previa |
| La splash screen tiene el tamaño incorrecto | Proporcioná imágenes iOS específicas via `pwa.splash.ios` |
| Contenido viejo luego de actualizar | Incrementá `cacheName` |
| El modo offline no funciona | Chequeá el estado del service worker en DevTools |
| El ícono se ve mal en Android | Proporcioná un ícono maskable con zona segura del 80 % |
