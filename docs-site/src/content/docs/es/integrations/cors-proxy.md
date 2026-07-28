---
title: CORS Proxy
description: Proxy del lado del servidor para APIs externas que no envían headers CORS.
---

Hacé fetch de APIs externas desde el JavaScript de tu artifact sin errores CORS. ShareOut
hace el proxy de la solicitud del lado del servidor y reenvía la respuesta.

## Inicio rápido

```javascript
const sdk = await ShareOut.create();

// Proxy por artifact (recomendado)
const proxyUrl = `https://shareout.site/v1/data/${sdk.artifactId}/proxy`;
const response = await fetch(`${proxyUrl}?url=${encodeURIComponent('https://api.weather.gov/points/39.7456,-104.9910')}`);
const data = await response.json();
```

## Cuándo usarlo

| Escenario | Solución |
| --- | --- |
| API sin headers CORS | Usá el proxy |
| APIs públicas (clima, crypto, etc.) | Usá el proxy |
| API que ya envía headers CORS | `fetch` directo |
| Tu propia API | Agregá headers CORS en tu servidor |

## Endpoints

**Proxy por artifact** (límites de tasa aislados, configurable):

```
GET https://shareout.site/v1/data/{artifactId}/proxy?url=<url-codificada>
```

**Proxy global** (límite de tasa compartido por IP, sin config):

```
GET https://shareout.site/api/proxy?url=<url-codificada>
```

```javascript
// Proxy global — más simple, no necesitás contexto de artifact
const response = await fetch(
  `https://shareout.site/api/proxy?url=${encodeURIComponent('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd')}`
);
```

## Restricciones

| Restricción | Valor |
| --- | --- |
| Método | Solo GET |
| Límite de tasa | 100 solicitudes/min por artifact |
| Tamaño de respuesta | Máximo 10 MB |
| Timeout | 10 segundos |
| TTL de caché | 5 min por defecto |

## Configuración (solo el dueño)

```javascript
// Leer configuración actual
const config = await fetch(`/v1/data/${artifactId}/proxy/config`, {
  headers: { 'Authorization': `Bearer ${token}` },
}).then(r => r.json());

// Actualizar configuración
await fetch(`/v1/data/${artifactId}/proxy/config`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    enabled: true,
    allowed_hosts: ['api.weather.gov', 'api.coingecko.com'],
    blocked_hosts: ['internal.company.com'],
    cache_ttl: 600,
    max_requests_per_minute: 50,
  }),
});
```

## Campos de configuración

| Campo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Habilitar o deshabilitar el proxy para este artifact |
| `allowed_hosts` | string[] | `null` | Lista de hosts permitidos — `null` significa cualquier host |
| `blocked_hosts` | string[] | `null` | Lista de hosts bloqueados |
| `cache_ttl` | number | `300` | TTL de caché en segundos (0–3600) |
| `max_requests_per_minute` | number | `100` | Límite de tasa (1–1000) |

## Headers de respuesta

| Header | Descripción |
| --- | --- |
| `X-Proxy-Cache` | `HIT` o `MISS` |
| `X-RateLimit-Remaining` | Solicitudes restantes en la ventana actual |

## Seguridad

Bloqueado automáticamente:

- IPs internas: `127.0.0.1`, `localhost`, `10.x`, `192.168.x`, `169.254.x`
- Esquemas: `file://`, `javascript:`, `data:`
- Los headers `Set-Cookie` son eliminados de las respuestas

## Errores

| Código | Significado |
| --- | --- |
| `BLOCKED_DESTINATION` | IP interna o esquema no permitido |
| `HOST_NOT_ALLOWED` | Host no está en `allowed_hosts` |
| `PROXY_RATE_LIMITED` | Se superó el límite de tasa |
| `FILE_TOO_LARGE` | La respuesta supera los 10 MB |
| `PROXY_ERROR` | Falló la solicitud al servidor de origen |
