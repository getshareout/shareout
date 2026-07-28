---
title: Introducción
description: Qué es ShareOut y cómo encaja la API en tu instancia.
---

ShareOut convierte una idea en una página web en vivo en **tu** instancia
self-hosted. Mandás archivos y obtenés una URL. A partir de ahí, la misma página
puede guardar datos, recibir subidas, enviar email y correr según un schedule —
todo a través de una sola API REST.

¿Sin instancia? [Install / self-host](/es/self-host/overview/) primero.

## La idea central: un artifact

Todo lo que publicás es un **artifact** — un bundle versionado de archivos
servido en una URL en vivo.

- **Archivos** — HTML, CSS, JS, imágenes. El entrypoint es `index.html` por defecto.
- **Versiones** — cada publicación crea una nueva versión. Avanzás siempre, nunca perdés el historial.
- **Visibilidad** — `private`, `workspace` o `public` (cualquiera en internet con el enlace).
- **Datos** — cada artifact tiene su propio store JSON, tablas y file blobs.
- **Jobs** — tareas programadas o disparadas por eventos asociadas al artifact.

## Qué podés hacer con la API

| Querés… | Endpoint |
| --- | --- |
| Publicar o actualizar una página | [`POST /v1/publish`](/api/operations/publishartifact/) |
| Listar y administrar artifacts | [`/v1/artifacts`](/api/operations/listartifacts/) |
| Leer o escribir datos del artifact | [`/v1/data/{id}/json`](/api/operations/getjson/) |
| Guardar archivos | [`/v1/data/{id}/blobs`](/api/operations/listblobs/) |
| Programar una tarea | [`/v1/jobs`](/api/operations/createjob/) |
| Compartir con colaboradores | [`/v1/artifacts/{id}/collaborators`](/api/operations/listcollaborators/) |

## Base URL

Usá el origen de **tu** instancia (`$ORIGIN`) — la URL workers.dev o el dominio
custom del install. No hay un host público de API de ShareOut.

```bash
# desde ~/.shareout/credentials → "origin", o:
export SHAREOUT_ORIGIN=https://shareout.<tu-cuenta>.workers.dev
```

¿Listo para publicar tu primera página? Andá al [Quickstart](/es/start/quickstart/).
