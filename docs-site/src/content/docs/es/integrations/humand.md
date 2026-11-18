---
title: Humand
description: Traé colaboradores, áreas, vacaciones y asistencia de Humand a tus artefactos.
---

Conectá tu comunidad de Humand una vez por workspace y armá páginas sobre tus datos de
personas: dotación por área, vacaciones del mes, asistencia, avance de cursos, respuestas
de encuestas.

El conector es **de solo lectura**. ShareOut solo usa los endpoints de lectura de Humand:
no puede crear, modificar ni dar de baja usuarios, publicar, subir documentos, leer chats
ni tocar tu API key.

## Conectar

1. Pedile a Humand la **API key** de tu comunidad (te la da tu contacto de implementación).
2. En ShareOut, abrí **Conectores** → **Personas y RR. HH.** → **Humand**.
3. Pegá la key (con o sin el prefijo `Basic `), tocá **Probar** y guardá.

Humand permite 100 consultas por minuto por key.

## Usarlo en un artefacto

```javascript
const sdk = await ShareOut.create();
const conn = (await sdk.platform.connections()).find((c) => c.name === 'humand');

const { data } = await sdk.platform.execute('humand', 'users.list', {
  connectionId: conn.id,
  params: { queryParams: { page: 1, limit: 100 } },
});
console.log(data.count, data.users);
```

Las listas vienen paginadas: mandá `page` (desde 1) y `limit` (hasta 500 en la mayoría); sin
ellos recibís la página 1 de a 10. El `pagination.cursor` de la respuesta es el número de la
página siguiente. `timeTracking.entries` necesita `employeeId`, `startDate` y `endDate`.

## Preguntale al asistente

Marcá **IA** en la tarjeta del conector de Humand y cualquier miembro del workspace puede
preguntarle al asistente de ShareOut (web, Telegram, Slack) o a ShareOut en Claude/ChatGPT
(MCP) cosas como "¿quién está de vacaciones la semana que viene?" o "¿cuántas personas hay
en cada área?". El asistente lee Humand con la herramienta `read_connector`, en solo lectura.

## Qué podés leer

| Área | Endpoints |
| --- | --- |
| Personas | `users.list`, `users.get`, `users.me`, `users.profilePictures`, `profileFields.list`, `segmentations.list`, `segmentations.users` |
| Organización | `departments.list` / `.get` / `.members`, `jobPositions.list` / `.get` / `.members` |
| Vacaciones | `timeOff.requests`, `timeOff.balances`, `timeOff.balancesByCycle` |
| Asistencia | `timeTracking.entries`, `timeTracking.daySummaries`, `workSchedules.list`, `shifts.calendar`, `shifts.planning`, `shifts.templates` |
| Capacitación | `courses.list` / `.get` / `.usersProgress`, `learningPaths.usersProgress`, `knowledgeLibraries.list` / `.get` / `.tree` |
| Engagement | `forms.answers`, `acknowledgements.list`, `goals.list`, `goalFormulas.list`, `competencies.list`, `exchanges.list` |
| Gestión de servicios | `serviceItems.list` / `.get` / `.tasks`, `serviceTasks.get` / `.approvalGroups`, `serviceStates.list` |

Los parámetros de consulta son los de Humand; mirá la
[referencia de la API pública de Humand](https://api-prod.humand.co/public/api/v1/api-docs/).

Los datos de Humand son datos personales. Mantené privadas las páginas que los muestran,
o compartilas solo con quienes deban verlos.
