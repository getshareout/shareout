---
title: Datasets
description: Leé extracts bulk versionados almacenados en R2, directo desde la fuente.
---

Archivos de datos versionados y de solo lectura (JSON o CSV) almacenados en R2. Accedé
vía `sdk.dataset(name)`. Usá un dataset cuando un dashboard necesite cargar **todo el
extract de una sola vez y filtrar o agregar en el cliente** — el modelo "cargá los datos,
después trabajalos". Para datos mutables por fila usá [tables](/es/sdk/tables/); para
fuentes externas en vivo usá [connections](/es/sdk/connections/).

## Métodos

```typescript
get<T>(): Promise<T[]>
// Todas las filas — lee el extract completo directo desde R2, parseado para vos.
// Cae en Worker stream si el R2 directo está bloqueado.

page<T>(opts?: { offset?: number; limit?: number }): Promise<DatasetPage<T>>
// Slice paginado server-side — usalo para datasets muy grandes sin traer todas las filas.

metadata(): Promise<DatasetMetadata>
// rowCount, columns, format, version, size, timestamps.

downloadUrl(): Promise<string>
// URL de corta duración directo desde R2 (bytes crudos). Usala para un link de
// descarga CSV o tu propio parser de streaming.

stream(): Promise<ReadableStream<Uint8Array>>
// Stream de bytes proxiado por el Worker (fallback).

list(): Promise<{ name: string; format: string; sizeBytes: number; version: number; updatedAt: string }[]>
// Todos los datasets de este artifact.
```

```typescript
interface DatasetMetadata {
  name: string;
  format: 'json' | 'csv';
  sizeBytes: number;
  version: number;
  rowCount?: number;
  columns?: string[];
  createdAt: string;
  updatedAt: string;
}

interface DatasetPage<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
```

## Ejemplos

```javascript
// Cargar todo el extract y filtrar en el cliente — sin Worker, sin hit a la fuente por vista
const rows = await sdk.dataset('shipments').get();
const late = rows.filter(r => r.status === 'delayed');

// Paginar un dataset grande server-side
const page = await sdk.dataset('shipments').page({ offset: 0, limit: 100 });

// URL cruda — pasala a un link <a download> o streaméala vos mismo
const url = await sdk.dataset('shipments').downloadUrl();

// Inspeccionar metadata antes de cargar
const meta = await sdk.dataset('shipments').metadata();
console.log(meta.rowCount, meta.sizeBytes);
```

## Modelo de egress

`get()` lee los bytes **directamente desde R2** (sin pasar por el Worker) y los parsea
en el browser. La autenticación es aplicada por el Worker antes de firmar la URL — la URL
es de corta duración y privada al artifact. Si el R2 directo está bloqueado (p. ej., mala
configuración de CORS), `get()` cae automáticamente en el stream del Worker.

Usá `downloadUrl()` cuando necesités la URL cruda para un link de descarga. Usá `page()`
para evitar traer todo el extract al browser con archivos muy grandes.

## Crear un dataset

Los datasets se escriben materializando una consulta o enviando filas — ver
[connections](/es/sdk/connections/) `materialize()`. Este store es **de solo lectura**.

## Límites

| Restricción | Valor |
|-------------|-------|
| Por archivo (tope duro) | 500 MB |
| Almacenamiento total de la instancia | `STORAGE_QUOTA_BYTES` (0 / sin set = ilimitado) |
| Tope por archivo de la instancia | `STORAGE_MAX_FILE_BYTES` (0 / sin set = ilimitado, ≤ 500 MB duro) |
| Formatos | `json`, `csv` |

Los límites se aplican al subir y al hacer `materialize()`. Un archivo que excede el límite
devuelve `FILE_TOO_LARGE` (413); superar el almacenamiento total devuelve
`STORAGE_QUOTA_EXCEEDED` (507). El almacenamiento se suma por workspace entre datasets
subidos, datasets materializados, blobs y assets de artifacts.
