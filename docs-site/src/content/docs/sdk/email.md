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
