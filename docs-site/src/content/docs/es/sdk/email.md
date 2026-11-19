---
title: Email
description: Enviá email de formulario de contacto al dueño del artefacto.
---

import { Aside } from '@astrojs/starlight/components';

Email saliente desde tu artefacto. Accedé vía `sdk.email`. El correo se envía del lado del
servidor desde una dirección verificada de ShareOut; los visitantes solo pueden escribirle
al **dueño** del artefacto — nunca a destinatarios arbitrarios.

## Métodos

```typescript
status(): Promise<EmailStatus>                       // is email configured?
notifyOwner(params): Promise<EmailSendResult>        // send to the owner
```

```typescript
interface EmailNotifyOwnerParams {
  subject?: string;
  text?: string;                // required if no html
  html?: string;                // required if no text
  replyTo?: string;             // visitor's address, for the owner's reply
  includeArtifactLink?: boolean; // default true
}
```

## Formulario de contacto

```javascript
const { enabled, ownerEmailConfigured } = await sdk.email.status();
if (!enabled || !ownerEmailConfigured) {
  // Fall back to sdk.table() to capture leads
}

await sdk.email.notifyOwner({
  subject: `Contact from ${name}`,
  text: `${message}\n\nFrom: ${name} <${email}>`,
  replyTo: email,
});
```

<Aside type="note" title="Límites">
50 emails/día por cuenta · 10/día por artefacto (SDK + jobs combinados).
</Aside>

## Cuando el email no está disponible

En una instancia sin envío de email configurado, un envío lanza un `ShareOutError` con
`status: 503` y `code: "EMAIL_UNAVAILABLE"`. Revisá `status().enabled` antes y usá una
alternativa, como en el ejemplo de arriba.

## Darse de baja

Cada email que manda un artefacto — desde el SDK, un job programado o un crew — lleva un
link **Darte de baja** al pie y un header `List-Unsubscribe` de un clic. La baja es **por
artefacto**: esa dirección deja de recibir emails de este artefacto nada más, no de tus
otros artefactos, y la página de confirmación le deja volver a suscribirse. Los envíos
siguientes saltean esa dirección (los resultados de jobs y crews la listan en
`skippedOptedOut`); un envío cuyo único destinatario se dio de baja falla.

Los dueños y editores pueden ver quién se dio de baja:

```http
GET /v1/data/{artifactId}/email/optouts
→ { "success": true, "data": { "optouts": [{ "email": "ana@acme.com", "created_at": "…" }] } }
```

## Email programado y masivo

Para envíos por cron o múltiples destinatarios, usá un [job](/es/guides/jobs/) en su lugar
(`action: "email"`) — mirá [Create a job](/api/operations/createjob/).

## Templates

Templates reutilizables con interpolación de variables vía `sdk.templates`
(`create` / `list` / `preview` / `update` / `delete`). Usá mustache `{{data.*}}`
y built-ins como `{{artifact.name}}`, `{{date}}`:

```javascript
const tpl = await sdk.templates.create({
  name: 'Weekly Report',
  subject: '{{artifact.name}} — {{date}}',
  html: '<h1>{{artifact.name}}</h1><p>{{data.summary}}</p>',
  variables: [{ name: 'summary', type: 'string', required: true }],
});

const rendered = await sdk.templates.preview(tpl.id, { summary: 'Up 15%' });
```

Referenciá un template desde un job programado con `template_id` + `template_data`.
