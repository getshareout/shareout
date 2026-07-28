# SDK: Email

Outbound email via Cloudflare Email Service. Access via `sdk.email`.

Mail is sent server-side from verified ShareOut domains (e.g. `slug@artifacts.example.com`). The SDK exposes a **safe contact-form API** — visitors cannot send to arbitrary addresses.

## Prerequisites

1. **Cloudflare:** Onboard `$ORIGIN_HOST` under Email Sending
2. **Owner:** Link account email (`POST /v1/auth/link-email`)
3. **Owner (recommended):** Create artifact sender address (`POST /v1/artifacts/{id}/email`)
4. **Artifact HTML:** Call `sdk.email.notifyOwner()` from submit handler

## Methods

```typescript
// Check platform + owner readiness
status(): Promise<EmailStatus>

// Send contact message to artifact owner only
notifyOwner(params: EmailNotifyOwnerParams): Promise<EmailSendResult>
```

## Types

```typescript
interface EmailNotifyOwnerParams {
  subject?: string;           // default: "Message from {artifact name}"
  text?: string;              // plain body (required if html omitted)
  html?: string;              // HTML body (required if text omitted)
  replyTo?: string;           // visitor email for owner Reply
  includeArtifactLink?: boolean; // default true
}

interface EmailSendResult {
  sent: boolean;
  messageId?: string;
  to: string;                 // owner email (always)
}

interface EmailStatus {
  enabled: boolean;           // EMAIL binding configured
  from?: string;              // e.g. my-app@artifacts.example.com
  ownerEmailConfigured: boolean;
}
```

## Examples

```javascript
const sdk = new ShareOut();

// Check availability
const { enabled, ownerEmailConfigured, from } = await sdk.email.status();
if (!enabled || !ownerEmailConfigured) {
  console.warn('Email unavailable — use sdk.table() for leads instead');
}

// Contact form submit
await sdk.email.notifyOwner({
  subject: 'New inquiry from portfolio',
  text: 'User asked about workspace member roles.',
  replyTo: 'visitor@example.com',
  includeArtifactLink: true,
});
```

## Contact Form Pattern

```html
<form id="contact-form">
  <input type="text" id="name" placeholder="Name" required>
  <input type="email" id="email" placeholder="Email" required>
  <textarea id="message" placeholder="Message" required></textarea>
  <button type="submit">Send</button>
</form>

<script>
  const sdk = new ShareOut();

  document.getElementById('contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const message = document.getElementById('message').value;

    await sdk.email.notifyOwner({
      subject: `Contact from ${name}`,
      text: `${message}\n\nFrom: ${name} <${email}>`,
      replyTo: email,
      includeArtifactLink: true,
    });

    alert('Message sent!');
  });
</script>
```

## Error Codes

| Code | Description |
|------|-------------|
| `RATE_LIMITED` | Daily email cap for artifact or user |
| `INVALID_REQUEST` | Missing body, invalid replyTo, owner has no email |
| `CONFIG_ERROR` | Email binding not configured |
| `INTERNAL_ERROR` | Cloudflare send failed |

## Rate Limits

- **50** emails per day per account (owner)
- **10** emails per day per artifact (SDK + jobs combined)

## Scheduled Email (Owner API)

For cron jobs and multi-recipient sends, use REST API:

```http
POST /v1/jobs
Authorization: Bearer so_xxx

{
  "artifact_id": "art_abc123",
  "action": "email",
  "schedule": "0 9 * * 1",
  "config": {
    "recipients": ["team@company.com"],
    "subject": "Weekly report",
    "html": "<h1>Update</h1>"
  }
}
```

For a **data-driven report email** whose numbers change each run, don't hardcode `html`. Set `useArtifactEmailHtml: true` and have the page publish `window.__shareoutExport = { emailSubject, emailHtml, csv }` then `window.__shareoutReady = true` — the worker re-renders the live artifact (owner-authed) and sends that. The `emailHtml` must be inline-styled. See [api/jobs.md → Data-driven report emails](../api/jobs.md#live-render) for the full contract.

See [api/jobs.md](../api/jobs.md) for full reference.

## Templates {#templates}

Reusable email templates with variable interpolation. Access via `sdk.templates`.

### Template Methods

```typescript
// List all templates (account-level or artifact-scoped)
sdk.templates.list(scope?: 'account' | 'artifact' | 'all'): Promise<EmailTemplate[]>

// Get single template
sdk.templates.get(id: string): Promise<EmailTemplate | null>

// Create template
sdk.templates.create(params: CreateTemplateParams): Promise<EmailTemplate>

// Update template
sdk.templates.update(id: string, params: Partial<CreateTemplateParams>): Promise<EmailTemplate>

// Delete template
sdk.templates.delete(id: string): Promise<boolean>

// Preview template with data (renders without sending)
sdk.templates.preview(templateId: string, data?: Record<string, unknown>): Promise<RenderedEmail>

// Preview inline template without saving
sdk.templates.previewInline(html: string, subject: string, data?: Record<string, unknown>): Promise<RenderedEmail>
```

### Template Types

```typescript
interface EmailTemplate {
  id: string;
  artifact_id: string | null;  // null = account-level
  owner_id: string;
  name: string;
  subject: string;
  html: string;
  text_body?: string;
  variables_schema: TemplateVariablesSchema;
  is_system: boolean;
  created_at: number;
  updated_at: number;
}

interface CreateTemplateParams {
  name: string;
  subject: string;
  html: string;
  text_body?: string;
  artifact_id?: string;         // Omit for account-level
  variables?: TemplateVariable[];
}

interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required?: boolean;
  default?: unknown;
  description?: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
  warnings?: string[];  // Missing variable warnings
}
```

### Built-in Variables

Templates support mustache-style `{{variable}}` interpolation:

| Variable | Value |
|----------|-------|
| `{{artifact.id}}` | Artifact ID |
| `{{artifact.name}}` | Artifact name |
| `{{artifact.url}}` | Public URL |
| `{{artifact.slug}}` | URL slug |
| `{{date}}` | ISO date (YYYY-MM-DD) |
| `{{datetime}}` | ISO datetime |
| `{{timestamp}}` | Unix timestamp |
| `{{data.*}}` | User-provided data |

### Template Examples

```javascript
const sdk = new ShareOut();

// Create account-level template
const template = await sdk.templates.create({
  name: 'Weekly Report',
  subject: '{{artifact.name}} - Weekly Update for {{date}}',
  html: `
    <h1>Report for {{artifact.name}}</h1>
    <p>Generated: {{datetime}}</p>
    <p>Summary: {{data.summary}}</p>
    <p><a href="{{artifact.url}}">View Dashboard</a></p>
  `,
  variables: [
    { name: 'summary', type: 'string', required: true }
  ]
});

// Preview before sending
const preview = await sdk.templates.preview(template.id, {
  summary: 'Sales up 15% this week'
});
console.log(preview.subject); // "My Dashboard - Weekly Update for 2026-05-31"
console.log(preview.html);    // Rendered HTML with variables replaced

// Use template in scheduled job (via REST API)
// See api/jobs.md for template_id in email config
```

### Artifact-Scoped Templates

```javascript
// Create template scoped to specific artifact
const template = await sdk.templates.create({
  name: 'Dashboard Alert',
  artifact_id: 'art_abc123',  // Scoped to this artifact
  subject: 'Alert: {{data.metric}} threshold exceeded',
  html: '<p>{{data.metric}}: {{data.value}} (threshold: {{data.threshold}})</p>',
  variables: [
    { name: 'metric', type: 'string', required: true },
    { name: 'value', type: 'number', required: true },
    { name: 'threshold', type: 'number', required: true, default: 100 }
  ]
});

// List only artifact templates
const artifactTemplates = await sdk.templates.list('artifact');

// List all (account + artifact)
const allTemplates = await sdk.templates.list('all');
```

## Related

- [REST API: Templates](../api/templates.md) - REST endpoints
- [REST API: Jobs](../api/jobs.md) - Using templates in scheduled jobs
- [Patterns: Forms](../patterns/forms.md) - Form patterns
