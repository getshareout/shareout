---
title: Google Sheets
description: Leé datos de planillas dentro de tu artifact con OAuth.
---

Traé filas de un Google Sheet directo a tu página. Accedé vía `sdk.sheets`.

## Inicio rápido

```javascript
const sdk = await ShareOut.create();

if (!await sdk.sheets.isConnected()) {
  const ok = await sdk.sheets.authorize();   // opens OAuth popup
  if (!ok) return;
}

const { data, headers, rowCount } = await sdk.sheets.fetch({
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/ABC123/edit',
  range: 'Sheet1',
  headers: true,
});
```

## Métodos

```typescript
getAuthUrl(returnUrl?): Promise<{ authUrl, message }>
authorize(returnUrl?): Promise<boolean>
isConnected(): Promise<boolean>
fetch({ spreadsheetUrl?, spreadsheetId?, range?, headers? }): Promise<{ data, headers?, rowCount }>
```

Pasá `spreadsheetUrl` o `spreadsheetId`. Con `headers: true`, cada fila
se convierte en un objeto con las claves de los nombres de columna de la primera fila.

## Cacheá el resultado

Traé los datos una vez, guardalos en `sdk.json`, y renderizá desde ahí para que la navegación no
los vuelva a traer:

```javascript
const { data } = await sdk.sheets.fetch({ spreadsheetId: 'ID', range: 'Data!A1:Z100', headers: true });
await sdk.json.set('sheetsData', { data, fetchedAt: Date.now() });
```

## Errores

| Código | Significado |
| --- | --- |
| `SHEETS_NOT_CONNECTED` | OAuth no completado — llamá a `authorize()` |
| `SHEETS_ACCESS_DENIED` | La planilla no está compartida con la cuenta conectada |
| `FETCH_ERROR` | Error de la API de Google Sheets |

## Monitoreo de datos obsoletos

Cuando una página usa una conexión de **Google Sheets**, ShareOut registra
`last_synced_at` en cada sync. Un barrido horario marca conexiones sin sync en
**7+ días** y deja una tarjeta **Stale data** en la campana (y las incluye en el
[digest semanal del workspace](/es/everyone/your-workspace/#digest-semanal-del-workspace)).
Re-notifica como máximo una vez por semana mientras siga obsoleta. Abrí la página y
re-sincronizá (o arreglá la conexión) para limpiar la condición.

Otros conectores de Data Platform (Snowflake, GA, Shopify, etc.) son proxies de
consulta en vivo sin timestamp de sync — este sentinel aplica solo a Sheets hoy.
