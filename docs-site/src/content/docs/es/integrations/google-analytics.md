---
title: Google Analytics
description: Reportes y métricas de GA4 vía un conector del workspace y clave de cuenta de servicio.
---

Consultá datos de reportes de GA4 desde un artifact mediante un **conector del
workspace**. ShareOut genera tokens de corta duración en el servidor a partir de
tu clave de cuenta de servicio — sin flujo OAuth de ShareOut.

## Configuración (admin del workspace)

1. En Google Cloud, creá una cuenta de servicio con rol **Viewer** en tu propiedad GA4.
2. Descargá la clave JSON.
3. En ShareOut → **Conectores** del workspace, elegí **Google Analytics** y pegá
   la clave más el ID de propiedad GA4.
4. Usá **Test** para verificar antes de guardar.

## Consulta desde un artifact

```javascript
const sdk = await ShareOut.create();

const { data } = await sdk.connection('team_ga').fetch({
  endpoint: 'reports.run',
  body: {
    dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
  },
  params: { propertyId: '123456789' },
});
```

## Endpoints

| Endpoint | Método | Descripción |
| --- | --- | --- |
| `reports.run` | POST | Reporte estándar |
| `reports.realtime` | POST | Reporte en tiempo real (cache 30 s) |
| `metadata.get` | GET | Dimensiones y métricas disponibles |

## Errores

| Código | Significado |
| --- | --- |
| `GA_NOT_CONNECTED` | Conector ausente o credenciales inválidas |
| `GA_ACCESS_DENIED` | Propiedad no accesible con la cuenta de servicio |
| `MISSING_PROPERTY_ID` | Falta `propertyId` |
