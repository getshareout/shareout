---
title: Email
description: Send contact-form email to the artifact owner.
---

import { Aside } from '@astrojs/starlight/components';

Outbound email from your artifact. Access via `sdk.email`. Mail is sent
server-side from a verified ShareOut address; visitors can only message the
artifact **owner** — never arbitrary recipients.

## Methods

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

## Contact form

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

<Aside type="note" title="Limits">
50 emails/day per account · 10/day per artifact (SDK + jobs combined).
</Aside>

## When email isn't available

On an instance with no email sending set up, a send throws a `ShareOutError` with
`status: 503` and `code: "EMAIL_UNAVAILABLE"`. Check `status().enabled` first and fall
back, as in the example above.

## Unsubscribe

Every email an artifact sends — from the SDK, a scheduled job or a crew — carries an
**Unsubscribe** link in its footer and a one-click `List-Unsubscribe` header. The opt-out
is **per artifact**: that address stops getting email from this artifact only, not from
your other artifacts, and the confirmation page lets them opt back in. Later sends skip
the address (job and crew results list it under `skippedOptedOut`); a send whose only
recipient opted out fails.

Owners and editors can list who opted out:

```http
GET /v1/data/{artifactId}/email/optouts
→ { "success": true, "data": { "optouts": [{ "email": "ana@acme.com", "created_at": "…" }] } }
```

## Scheduled & bulk email

For cron sends or multiple recipients, use a [job](/guides/jobs/) instead
(`action: "email"`) — see [Create a job](/api/operations/createjob/).

## Templates

Reusable, variable-interpolated templates via `sdk.templates`
(`create` / `list` / `preview` / `update` / `delete`). Use mustache `{{data.*}}`
and built-ins like `{{artifact.name}}`, `{{date}}`:

```javascript
const tpl = await sdk.templates.create({
  name: 'Weekly Report',
  subject: '{{artifact.name}} — {{date}}',
  html: '<h1>{{artifact.name}}</h1><p>{{data.summary}}</p>',
  variables: [{ name: 'summary', type: 'string', required: true }],
});

const rendered = await sdk.templates.preview(tpl.id, { summary: 'Up 15%' });
```

Reference a template from a scheduled job with `template_id` + `template_data`.
