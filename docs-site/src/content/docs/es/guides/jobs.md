---
title: Programar jobs
description: Ejecutá tareas en un cron o en respuesta a eventos de un artefacto.
---

Un job ejecuta una tarea asociada a un artefacto — con una programación, o cuando algo
pasa. Mandá un reporte semanal por email, posteá un snapshot a Slack, refrescá un dataset.

## Dos triggers

| Trigger | Se dispara |
| --- | --- |
| `cron` | Según una programación de tiempo (campo `schedule`) |
| `event` | En `artifact.updated`, `artifact.viewed`, `comment.added` o `email.received` |

## Acciones

| Acción | Hace |
| --- | --- |
| `email` | Envía a los destinatarios (HTML inline o un template) |
| `slack` | Postea un mensaje, snapshot o PDF a un canal o DM |
| `discord` | Postea a un webhook de Discord |
| `telegram` | Mensaje, snapshot o PDF a un chat de Telegram vinculado |
| `webhook` | Request HTTP a tu URL |
| `http_get` | GET simple |
| `materialize` | Vuelve a correr una query de conexión y guarda el resultado |
| `email_sheet_sync` | En `email.received`: un Excel/CSV que un remitente permitido y verificado manda a la dirección del artefacto reemplaza uno de sus datasets |
| `query_snapshot` | Corre queries fijas de warehouse/REST en schedule y escribe cada resultado en json/tabla/dataset |
| `sheets_append` | Corre una query de conexión y agrega filas a una Google Sheet (historial diario creciente) |
| `public_sheet_sync` | Copia una pestaña de una planilla compartida como "Cualquier persona que tenga el vínculo" a uno de los datasets del artefacto, según un horario. Sin iniciar sesión en Google |
| `drive_file_sync` | Copia una pestaña de una planilla privada de Google Drive que el creador eligió en Google a uno de los datasets del artefacto, según un horario |

## Crear un job

```bash
curl -X POST https://shareout.site/v1/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "artifact_id": "art_abc123",
    "title": "Email semanal de revenue",
    "description": "Manda al equipo el resumen de revenue cada lunes 9am UTC.",
    "action": "email",
    "trigger_type": "cron",
    "schedule": "0 9 * * 1",
    "config": {
      "recipients": ["team@company.com"],
      "subject": "Weekly report",
      "includeArtifactLink": true
    }
  }'
```

Siempre definí `title` y `description` al crear un schedule — aparecen en **Mis
schedules** y en **Admin → Schedules** del workspace. `PATCH /v1/jobs/{id}` también
acepta `title` / `description` (mandá `null` para borrar).

### Formato cron

```
┌─ minute (0-59)
│ ┌─ hour (0-23)
│ │ ┌─ day of month (1-31)
│ │ │ ┌─ month (1-12)
│ │ │ │ ┌─ day of week (0-6, Sun=0)
* * * * *
```

`0 9 * * 1` → lunes 9am · `*/15 * * * *` → cada 15 min · `0 9-17 * * 1-5` →
cada hora, horario laboral.

### `query_snapshot` — refresh determinístico de datos

Corre una lista configurada de queries contra una conexión del workspace — REST **o**
conectores warehouse inline (Snowflake, BigQuery). Los jobs `query_snapshot`
programados refrescan sin intervención; no hace falta un paso externo de pre-fetch
para conexiones warehouse genéricas.

```json
{
  "artifact_id": "art_dashboard",
  "action": "query_snapshot",
  "trigger_type": "cron",
  "schedule": "0 6 * * *",
  "config": {
    "connection": "team_bigquery",
    "params": { "projectId": "my-gcp-project" },
    "queries": [
      {
        "query": "SELECT region, SUM(revenue) AS revenue FROM analytics.daily GROUP BY 1",
        "target": { "type": "json", "name": "snapshot", "path": "byRegion" }
      }
    ]
  }
}
```

### `sheets_append` — warehouse → Google Sheet

Corre una query de conexión y **agrega las filas resultantes a una Google Sheet
conectada** — un nuevo bloque de filas en cada ejecución, para mantener un historial
diario creciente en una hoja de cálculo.

```json
{
  "artifact_id": "art_abc123",
  "title": "Revenue diario a la sheet",
  "description": "Agrega las filas de ayer del warehouse a la Google Sheet compartida.",
  "action": "sheets_append",
  "trigger_type": "cron",
  "schedule": "0 12 * * *",
  "config": {
    "connection": "bigquery",
    "params": { "projectId": "my-gcp-project" },
    "query": "SELECT FORMAT_DATE('%Y-%m-%d', date) AS date, site, revenue FROM `my-gcp-project.analytics.daily` WHERE date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)",
    "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/1AbCdEf.../edit",
    "range": "Daily",
    "columns": ["date", "site", "revenue"]
  }
}
```

**Requisitos:**

- El **dueño** del artefacto debe tener **Google Sheets conectado** — sin token → el
  job falla con *"Google Sheets not connected"*.
- El dueño necesita **acceso de edición** a la hoja; la pestaña en `range` debe
  existir.
- Las filas se agregan **sin encabezado** — configurá la fila de encabezado una vez.
  Usá `columns` para fijar el orden de celdas.


### Evento `email.received`

Combiná con cualquier acción para reaccionar cuando llega mail al
[inbox del artefacto](/es/everyone/inbox/):

```json
{
  "artifact_id": "art_inbox",
  "action": "slack",
  "trigger_type": "event",
  "event_type": "email.received",
  "config": {
    "connection": "team_slack",
    "channelId": "C0123456789"
  }
}
```

### `email_sheet_sync` — actualizar los datos de un artefacto por email

Alguien manda (o reenvía automáticamente) un Excel o CSV a la dirección propia del artefacto y la
primera pestaña del archivo reemplaza uno de sus datasets. Solo remitentes permitidos y verificados.

```bash
# 1. quién puede mandarlo (activa la dirección) → { address, senders }
curl -X PUT https://shareout.site/v1/artifacts/art_abc123/email-sync/senders \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "senders": ["ana@acme.com"] }'
# 2. qué dataset lee el artefacto → suggestedDataset (null = lee varios: preguntá)
curl https://shareout.site/v1/artifacts/art_abc123/email-sync -H "Authorization: Bearer $TOKEN"
# 3. el job → 201 { job, address, senders, warning? }
curl -X POST https://shareout.site/v1/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "artifact_id": "art_abc123", "action": "email_sheet_sync", "trigger_type": "event",
        "event_type": "email.received", "title": "Actualizar por email", "config": { "dataset": "ventas" } }'
```

- Un `warning` en el `201` quiere decir que el artefacto no lee ese dataset: quedaría vacío.
- Uno por artefacto y dataset: un segundo da `409 DUPLICATE_JOB` con el `job_id` existente.
- `POST /v1/jobs/{id}/run` responde `409 NOT_RUNNABLE` con la dirección y no cambia nada: corre cuando llega el mail.
- `GET /v1/artifacts/{id}/email-sync` → `state` (`off` · `inbox_off` · `waiting_first_email` · `ok` · `failed`), un `message` de una línea, `lastRejected` (el último email rechazado y por qué) y `recentRejected` (hasta 5, el más nuevo primero; `canAllow: true` = un reporte que reenvió automáticamente un correo permitido, cuyo remitente verificado se agrega con un `PUT …/senders`).
- Reenvío automático de Gmail: Gmail primero le manda una confirmación a la dirección del artefacto. Una genuina (DKIM y DMARC pasan para google.com según Cloudflare, el remitente de reenvío de Google, el link en un host propio de Google) no se rebota ni se vuelve datos: aparece en `forwarding` (`requester`, `confirmUrl`, `code` en las viejas, `expiresAt`) para que la abran los editores del artefacto. `POST /v1/artifacts/{id}/email-sync/forwarding/{confirmationId}` `{ "action": "opened" | "dismiss" }`. Outlook / Microsoft 365 no tiene paso de confirmación.
- Borrar el job apaga la dirección y conserva los datos y la lista de remitentes (`senders_kept`).
- Límites: 8 MB y 100.000 filas por archivo, 25 MB por email, 200 emails por día por artefacto.

### `public_sheet_sync` y `drive_file_sync` — mantener un dataset al día con una planilla

Los dos copian una pestaña de una planilla a uno de los datasets del artefacto según un horario
cron. La app (Automatizar → **Actualizar los datos**) usa por defecto la primera pestaña, todos los
días a las 08:00, y corre la primera sincronización en el momento. Paso a paso para personas:
[Mantené un artefacto al día desde una planilla](/es/everyone/google-sheets/#mantené-un-artefacto-al-día-desde-una-planilla).

- `public_sheet_sync` — `config: { link, dataset, sheet?, fileName? }`. El archivo tiene que estar
  compartido como "Cualquier persona que tenga el vínculo" (una planilla de Google o un Excel en Drive).
  Revisá el enlace antes con `POST /v1/workspaces/{workspaceId}/sheet-links/inspect` `{ "link": "…" }`
  → sus pestañas, cantidad de filas y columnas. Cualquiera que tenga el enlace puede leer el archivo:
  usalo solo para datos que pueden ser públicos.
- `drive_file_sync` — `config: { fileId, dataset, sheet?, fileName? }`. Un archivo privado: la
  persona lo elige una vez en la ventana de Google (`GET /v1/workspaces/{workspaceId}/file-imports/sheet-sync/pick`,
  abierto en su navegador), y ShareOut solo puede leer los archivos elegidos así.
  `GET /v1/workspaces/{workspaceId}/file-imports/sheet-sync` → `picked` es el último que eligió.
- Una corrida cuyas filas no cambiaron no escribe nada. Límites: 8 MB y 100.000 filas por archivo.
- Referencia completa de la config: `api/jobs.md` del skill (`PublicSheetSyncConfig`, `DriveFileSyncConfig`).

## Reintentos

Agregá `retry_config` para downstreams inestables:

```json
{ "maxAttempts": 3, "backoffType": "exponential", "initialDelay": 60 }
```

`fixed` · `linear` (`delay × (attempt+1)`) · `exponential` (`delay × 2^attempt`).

## Ejecutar, pausar, inspeccionar

| Acción | Endpoint |
| --- | --- |
| Ejecutar ahora | `POST /v1/jobs/{id}/run` (no `email_sheet_sync`: corre cuando llega el mail) |
| Pausar | `PATCH /v1/jobs/{id}` → `{ "enabled": false }` |
| Logs recientes | `GET /v1/jobs/{id}/logs` |

Los admins del workspace también pueden usar el **Run Inspector** — vista unificada
de jobs programados, automatizaciones crew y disparos de alertas de métricas:

```http
GET /v1/workspaces/{id}/runs?surface=job&status=failed
GET /v1/workspaces/{id}/runs/{surface}/{runId}
```

Cada run devuelve un `RunDetail` normalizado con estado, trigger, ledger de pasos
(fases fetch / transform / deliver), resultado de entrega y costo/tokens cuando
aplica. Ver [Admin del workspace → Run Inspector](/es/teams/admin/#run-inspector).

Mirá el schema completo en la [referencia de la API](/api/operations/createjob/).

Combiná `query_snapshot` con un [Crew](/es/guides/crew/) en un cron posterior para
narrar y entregar — el patrón **refrescar → narrar → entregar**.
