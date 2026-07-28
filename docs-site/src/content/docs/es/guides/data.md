---
title: Almacenar datos
description: JSON, tablas y file blobs para cada artifact.
---

Cada artifact tiene su propio almacenamiento — sin una base de datos aparte que aprovisionar. Tres
formas, un mismo base path: `/v1/data/{artifactId}`.

## JSON store

Un store **clave/valor** de documentos JSON por artifact. Cada clave guarda un valor
JSON (objeto, array, string, número, …). Ideal para settings y estado chico.

```bash
# Listar claves
curl -H "Authorization: Bearer $TOKEN" \
  https://shareout.site/v1/data/art_abc123/json

# Leer una clave
curl -H "Authorization: Bearer $TOKEN" \
  https://shareout.site/v1/data/art_abc123/json/prefs

# Escribir una clave (el body es el valor JSON)
curl -X PUT https://shareout.site/v1/data/art_abc123/json/prefs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "theme": "dark", "views": 42 }'
```

Límites por defecto: **1 MB por valor**, **1000 claves** por artifact.

## Tablas

Filas estructuradas para listas, submissions y registros. Listá las tablas de un
artifact:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://shareout.site/v1/data/art_abc123/tables
```

Las tablas también habilitan las **row-level access policies** — filtrá filas por viewer para que cada
cliente vea solo sus propios datos. Configurá `access_policy` al publicar.

## Blobs (archivos)

Subí imágenes, video, audio y documentos como `multipart/form-data`:

```bash
curl -X POST https://shareout.site/v1/data/art_abc123/blobs \
  -H "Authorization: Bearer $TOKEN" \
  -F file=@chart.png
```

| Restricción | Valor |
| --- | --- |
| Por archivo | 50 MB |
| Por artifact | 500 MB |
| Máximo de blobs | 1000 |

Tipos permitidos: PNG, JPEG, GIF, WebP, SVG; MP4, WebM; MP3, WAV, OGG; PDF, TXT,
CSV, Markdown.

Mirá los endpoints completos en la [referencia de la API](/api/operations/uploadblob/).
