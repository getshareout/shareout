---
title: Sheets store
description: Leé y escribí en Google Sheets vía OAuth, con caché integrado y manejo de conexiones.
---

import { Aside } from '@astrojs/starlight/components';

Leé y escribí en Google Spreadsheets dentro de un artifact vía OAuth. Accedé vía `sdk.sheets`. Para una guía de configuración completa, consultá [la integración de Google Sheets](/es/integrations/google-sheets/).

## Métodos

```typescript
// OAuth
isConnected(): Promise<boolean>
authorize(returnUrl?: string): Promise<boolean>     // abre popup OAuth
getAuthUrl(returnUrl?: string): Promise<{ authUrl: string; message: string }>
status(): Promise<SheetsStatus>
connect(returnUrl?: string): void                    // redirección de página completa
disconnect(): Promise<void>

// Lectura
fetch<T>(options: FetchOptions): Promise<FetchResult<T>>
refresh<T>(options: FetchOptions): Promise<FetchResult<T>>  // sin caché

// Escritura (solo owner)
update(options: UpdateOptions): Promise<{ updated: boolean; updatedCells: number; updatedRows: number }>
append(options: AppendOptions): Promise<{ appended: boolean; appendedRows: number; appendedCells: number }>

// Manejo de conexiones nombradas (con sync)
list(): Promise<SheetConnection[]>
get(name: string): Promise<SheetConnection | null>
create(options: ConnectionOptions): Promise<SheetConnection>
delete(name: string): Promise<boolean>
import(connectionName: string): Promise<{ imported: number; targetTable: string; columns: string[] }>
export(connectionName: string): Promise<{ exported: number; spreadsheetId: string; columns: string[] }>

// Caché
cacheStatus(): Promise<{ caches: Array<{ key: string; cachedAt: string; rowCount: number }>; count: number }>
clearCache(spreadsheetId?: string): Promise<{ cleared: boolean }>
```

```typescript
interface FetchOptions {
  spreadsheetUrl?: string;   // URL completa de Google Sheets (uno de los dos es requerido)
  spreadsheetId?: string;    // ID del spreadsheet
  range?: string;            // nombre de hoja o rango A1
  headers?: boolean;         // primera fila como nombres de columnas (por defecto: false)
  cache?: boolean;           // usar caché de 5 min (por defecto: true)
  forceRefresh?: boolean;
}

interface FetchResult<T> {
  data: T[];
  headers?: string[];
  rowCount: number;
  cached?: boolean;
  cachedAt?: string;
}

interface ConnectionOptions {
  name: string;
  spreadsheetId: string;
  sheetName?: string;
  targetTable: string;
  syncDirection?: 'import' | 'export' | 'bidirectional';
  syncSchedule?: string;
}
```

## Ejemplos

### Obtener datos (flujo rápido)

```javascript
const sdk = await ShareOut.create();

if (!await sdk.sheets.isConnected()) {
  const ok = await sdk.sheets.authorize();
  if (!ok) return;
}

const { data, headers, rowCount } = await sdk.sheets.fetch({
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/ABC123/edit',
  range: 'Sheet1',
  headers: true,
});

// data = [{ Name: 'Alice', Score: 95 }, ...]
```

### Agregar filas (owner)

```javascript
await sdk.sheets.append({
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/ABC123/edit',
  range: 'Sheet1',
  values: [['Alice', 95], ['Bob', 87]],
});
```

### Actualizar un rango (owner)

```javascript
await sdk.sheets.update({
  spreadsheetId: 'ABC123',
  range: 'Sheet1!B2',
  values: [[99]],
});
```

### Conexión nombrada con sync a tabla

```javascript
// Crear una conexión que importe datos a una tabla de ShareOut
await sdk.sheets.create({
  name: 'ventas-sheet',
  spreadsheetId: 'ABC123',
  sheetName: 'Ventas',
  targetTable: 'ventas',
  syncDirection: 'import',
});

// Disparar una importación
const { imported } = await sdk.sheets.import('ventas-sheet');
console.log(`Se importaron ${imported} filas`);
```

### Actualizar caché

```javascript
// Forzar datos frescos, ignorando el caché de 5 min
const fresh = await sdk.sheets.refresh({
  spreadsheetId: 'ABC123',
  headers: true,
});
```

## Errores

| Code | Status | Descripción |
|------|--------|-------------|
| `SHEETS_NOT_CONNECTED` | 401 | OAuth no completado |
| `SHEETS_ACCESS_DENIED` | 403 | Hoja no compartida con la cuenta |
| `FETCH_ERROR` | 500 | Error de la API de Google Sheets |

<Aside type="note">
`fetch()` cachea los resultados por 5 minutos por defecto para reducir las llamadas a la API. Usá `refresh()` o `forceRefresh: true` cuando necesités datos en tiempo real. Los métodos de escritura (`update`, `append`) requieren autenticación del owner del artifact.
</Aside>
