---
title: Templates store
description: Create and render reusable email templates with variable interpolation.
---

Reusable email templates with mustache-style `{{variable}}` interpolation, usable in scheduled jobs and SDK email methods. Access via `sdk.templates`.

Templates can be scoped to an account (reusable across artifacts) or to a single artifact.

## Methods

```typescript
list(scope?: 'account' | 'artifact' | 'all'): Promise<EmailTemplate[]>
get(id: string): Promise<EmailTemplate | null>
create(params: CreateTemplateParams): Promise<EmailTemplate>
update(id: string, params: UpdateTemplateParams): Promise<EmailTemplate | null>
delete(id: string): Promise<boolean>
preview(templateId: string, artifactId: string, data?: Record<string, unknown>): Promise<RenderedEmail>
previewInline(html: string, subject: string, artifactId: string, data?: Record<string, unknown>): Promise<RenderedEmail>
```

```typescript
interface EmailTemplate {
  id: string;
  artifactId: string | null;   // null = account-level
  name: string;
  subject: string;
  html: string;
  textBody: string | null;
  variablesSchema: { variables: TemplateVariable[] };
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'json';
  required: boolean;
  default?: unknown;
  description?: string;
}

interface CreateTemplateParams {
  name: string;
  subject: string;
  html: string;
  textBody?: string;
  variables?: TemplateVariable[];
  artifactId?: string;         // omit for account-level
}

interface RenderedEmail {
  subject: string;
  html: string;
  text?: string;
  warnings?: string[];
}
```

## Built-in variables

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

Nested paths work: `{{data.user.email}}`. Missing variables render as empty string and appear in `warnings`.

## Examples

### Create an account-level template

```javascript
const sdk = await ShareOut.create();

const tpl = await sdk.templates.create({
  name: 'Weekly Report',
  subject: '{{artifact.name}} — {{date}}',
  html: '<h1>{{artifact.name}}</h1><p>Revenue: ${{data.revenue}}</p><p><a href="{{artifact.url}}">View</a></p>',
  variables: [
    { name: 'revenue', type: 'number', required: true },
  ],
});
console.log(tpl.id); // tpl_abc123
```

### Preview before sending

```javascript
const rendered = await sdk.templates.preview(tpl.id, sdk._artifactId, {
  revenue: 125000,
});
console.log(rendered.subject); // "My Dashboard — 2026-06-17"
```

### Preview inline (no save)

```javascript
const rendered = await sdk.templates.previewInline(
  '<p>Hello, {{data.name}}!</p>',
  'Welcome, {{data.name}}',
  sdk._artifactId,
  { name: 'Alice' }
);
```

### Use in a scheduled job

Reference a template ID in a job's email config:

```json
{
  "artifact_id": "art_abc123",
  "action": "email",
  "schedule": "0 9 * * 1",
  "config": {
    "recipients": ["team@company.com"],
    "template_id": "tpl_abc123",
    "template_data": { "revenue": 125000 }
  }
}
```

## Errors

| Code | Status | Description |
|------|--------|-------------|
| `NOT_FOUND` | 404 | Template or artifact not found |
| `FORBIDDEN` | 403 | Permission denied or system template |
| `INVALID_REQUEST` | 400 | Missing or invalid field |
