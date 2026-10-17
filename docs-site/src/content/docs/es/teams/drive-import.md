---
title: Traé tus archivos de Drive / SharePoint
description: Importá carpetas enteras de Google Drive, OneDrive o SharePoint a los archivos del workspace, mantenelas sincronizadas y convertí documentos en páginas.
---

import { Aside } from '@astrojs/starlight/components';

Pasá los archivos de un equipo a ShareOut sin descargarlos y volver a subirlos. Elegí
una carpeta en **Google Drive**, **OneDrive** o una biblioteca de documentos de
**SharePoint**, elegí dónde va, y ShareOut la copia con sus subcarpetas. Correlo de nuevo
cuando quieras: solo viene lo nuevo o lo que cambió.

## Quién puede importar

Los **owners** y **admins** del workspace, y los **miembros** mientras el workspace les
permita crear carpetas (*Configuración → los miembros pueden crear carpetas*). Los
miembros externos no.

## Importar una carpeta

1. En el workspace, abrí **Nuevo → Importar de Drive / OneDrive / SharePoint**.
2. **Conectá** el drive. Una ventana le pide a Google o Microsoft acceso de **solo
   lectura** a tus archivos. Es aparte de cómo iniciás sesión en ShareOut, y solo vos
   podés usar tu conexión.
3. **Elegí una carpeta.** Google: *Mi unidad*, *Compartido conmigo* o una unidad
   compartida. Microsoft: *Mis archivos (OneDrive)*, un sitio que seguís, o buscá un
   sitio de SharePoint → biblioteca → carpeta.
4. **Elegí dónde va**: el nivel principal de Archivos o dentro de una carpeta del Team
   Space. La carpeta elegida se crea ahí, con las mismas subcarpetas.
5. Dejá activado **Convertir documentos en páginas legibles** para tener una página al
   lado de cada Word, Excel, PDF, Markdown o CSV (y presentaciones, si la instancia tiene
   el conversor). El archivo original siempre queda.
6. **Empezá la importación** y seguí el progreso: encontrados, importados, páginas, sin
   cambios, omitidos y con error, más los archivos para revisar y por qué.

## Qué pasa con cada archivo

| En el drive | En ShareOut |
|---|---|
| Documentos / Hojas / Presentaciones de Google | Se exportan como `.docx` / `.xlsx` / `.pptx` |
| Dibujos de Google, Jamboards | Se exportan como PDF |
| Formularios, Sites, My Maps, Apps Script, accesos directos | Se omiten: no tienen forma de documento |
| Blocs de OneNote | Se omiten: exportalos desde OneNote primero |
| Scripts, páginas web, programas (`.js`, `.html`, `.exe`…) | Se omiten, como en cualquier subida |
| Todo lo demás | Se copia tal cual |

- Los archivos toman la **visibilidad de la carpeta de destino**: los de una carpeta
  privada quedan privados, los de una carpeta pública tienen link para compartir, y si
  no los ve el equipo. Las páginas creadas desde documentos nunca son públicas.
- Con [Conocimiento](/es/teams/knowledge/) activado, los archivos importados se aprenden
  como cualquier subida.
- Los nombres con acentos o símbolos se guardan con un nombre de archivo seguro; el
  nombre visible conserva el original.

## Sincronizar de nuevo, o todos los días

**Sincronizar de nuevo** vuelve a leer la carpeta y trae solo lo que cambió (la fecha de
modificación de Drive, la etiqueta de contenido de Microsoft). Un archivo que cambió pasa a
ser una **nueva versión** del mismo archivo, y su página una nueva versión de la misma
página. Los archivos movidos entre subcarpetas se mueven acá también. Los que se borran del
drive **se conservan** acá.

Marcá **Sincronizar todos los días** para hacerlo una vez por día (hasta 10 carpetas por
workspace).

## Límites

- Una importación lee como máximo **10.000 archivos**, **2.000 carpetas** y **20 niveles**;
  pasado eso termina con un aviso: importá el resto como carpetas más chicas.
- Aplican el **límite de almacenamiento** del workspace y el **límite por archivo**. Si el
  almacenamiento se llena, la importación se detiene limpia, lo avisa y conserva lo que ya
  copió; liberá espacio y sincronizá de nuevo para seguir.
- Google exporta documentos de hasta 10 MB; los más grandes se informan para que los
  descargues de Drive vos.
- Como máximo 300 documentos por corrida se convierten en páginas; el resto igual se
  importa como archivo.
- Si el drive limita la velocidad, ShareOut espera y reintenta solo.

## Desconectar

**Desconectar** en la misma ventana borra tu conexión (y la revoca en Google). Toda carpeta
que se sincroniza con ella se detiene, incluida una corrida en curso y la sincronización
diaria. Los archivos ya importados quedan. Para seguir sincronizando, conectá de nuevo e
importá la carpeta otra vez.

<Aside type="note">
**Self-hosting:** la función aparece cuando la instancia define `GOOGLE_DRIVE_CLIENT_ID` /
`GOOGLE_DRIVE_CLIENT_SECRET` y/o `MICROSOFT_FILES_CLIENT_ID` /
`MICROSOFT_FILES_CLIENT_SECRET` (más `CREDENTIALS_KEY`). URIs de redirección:
`$SHAREOUT_BASE_URL/v1/file-imports/oauth/google_drive/callback` y `…/microsoft/callback`.
Vinculá el Workflow `FILE_IMPORT` para carpetas grandes. Ver [Secretos](/es/self-host/secrets/).
</Aside>
