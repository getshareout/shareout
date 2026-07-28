# REST API: Templates

Reusable email templates with variable interpolation for scheduled jobs and SDK email methods.

## Endpoints

```http
POST   /v1/templates              # Create template
GET    /v1/templates              # List templates
GET    /v1/templates/{id}         # Get template
PATCH  /v1/templates/{id}         # Update template
DELETE /v1/templates/{id}         # Delete template
POST   /v1/templates/preview      # Preview inline template
POST   /v1/templates/{id}/preview # Preview saved template
```

## Template Scopes

| Scope | Description |
|-------|-------------|
| Account-level | `artifact_id: null` - Available for all artifacts owned by user |
| Artifact-scoped | `artifact_id: "art_xxx"` - Only usable with that artifact |
| System | `is_system: true` - Read-only, provided by ShareOut |

## POST /v1/templates (Create)

```json
{
  "name": "Weekly Report",
  "subject": "{{artifact.name}} - Weekly Update for {{date}}",
  "html": "<h1>Report</h1><p>{{data.summary}}</p>",
  "text_body": "Report\n\n{{data.summary}}",
  "artifact_id": null,
  "variables": [
    { "name": "summary", "type": "string", "required": true },
    { "name": "highlight", "type": "string", "required": false, "default": "None" }
  ]
}
```

### Request Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Template name (unique per owner+artifact) |
| `subject` | string | Yes | Email subject with variables |
| `html` | string | Yes | HTML body with variables |
| `text_body` | string | No | Plain text body |
| `artifact_id` | string | No | Scope to artifact (null = account-level) |
| `variables` | array | No | Variable schema for validation |

### Variable Schema

```typescript
interface TemplateVariable {
  name: string;                    // Variable name (accessed via {{data.name}})
  type: 'string' | 'number' | 'boolean' | 'date';
  required?: boolean;              // Default: false
  default?: unknown;               // Default value if not provided
  description?: string;            // Documentation
}
```

### Response

```json
{
  "success": true,
  "data": {
    "template": {
      "id": "tpl_abc123",
      "artifact_id": null,
      "owner_id": "user_xyz",
      "name": "Weekly Report",
      "subject": "{{artifact.name}} - Weekly Update for {{date}}",
      "html": "<h1>Report</h1><p>{{data.summary}}</p>",
      "text_body": "Report\n\n{{data.summary}}",
      "variables_schema": {
        "variables": [
          { "name": "summary", "type": "string", "required": true }
        ]
      },
      "is_system": false,
      "created_at": 1717200000,
      "updated_at": 1717200000
    }
  }
}
```

## GET /v1/templates (List)

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `scope` | string | `account`, `artifact`, or `all` (default: `all`) |
| `artifact_id` | string | Filter by artifact (for `artifact` scope) |

**Response:**

```json
{
  "success": true,
  "data": {
    "templates": [...],
    "count": 5
  }
}
```

## GET /v1/templates/{id}

Returns single template. System templates readable by all; user templates only by owner.

## PATCH /v1/templates/{id}

Update template properties. Cannot modify system templates.

```json
{
  "name": "Updated Name",
  "subject": "New Subject",
  "html": "<p>New HTML</p>",
  "variables": [...]
}
```

## DELETE /v1/templates/{id}

Delete user template. Cannot delete system templates.

## POST /v1/templates/preview (Inline)

Preview a template without saving it.

```json
{
  "artifact_id": "art_abc123",
  "inline_html": "<h1>{{artifact.name}}</h1><p>{{data.message}}</p>",
  "inline_subject": "Update from {{artifact.name}}",
  "data": {
    "message": "Hello World"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "rendered": {
      "subject": "Update from My Dashboard",
      "html": "<h1>My Dashboard</h1><p>Hello World</p>",
      "warnings": []
    }
  }
}
```

## POST /v1/templates/{id}/preview (Saved)

Preview a saved template with data.

```json
{
  "artifact_id": "art_abc123",
  "data": {
    "summary": "Sales up 15%",
    "highlight": "New record!"
  }
}
```

## Built-in Variables

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

**Nested paths:** Access nested objects with `{{data.user.email}}`.

**Missing variables:** Render as empty string with warning in response.

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `INVALID_REQUEST` | 400 | Missing or invalid field |
| `NOT_FOUND` | 404 | Template or artifact not found |
| `FORBIDDEN` | 403 | Permission denied or system template |
| `INVALID_JSON` | 400 | Malformed request body |

## Examples

### Account-Level Template for Reports

```json
{
  "name": "Monthly Sales Report",
  "subject": "{{artifact.name}} - {{date}}",
  "html": "<h1>{{artifact.name}}</h1><p>Revenue: ${{data.revenue}}</p><p>Growth: {{data.growth}}%</p><p><a href=\"{{artifact.url}}\">View Dashboard</a></p>",
  "variables": [
    { "name": "revenue", "type": "number", "required": true },
    { "name": "growth", "type": "number", "required": true }
  ]
}
```

### Artifact-Scoped Alert Template

```json
{
  "name": "Threshold Alert",
  "artifact_id": "art_dashboard",
  "subject": "Alert: {{data.metric}} exceeded threshold",
  "html": "<p><strong>{{data.metric}}</strong> is at {{data.value}} (threshold: {{data.threshold}})</p>",
  "variables": [
    { "name": "metric", "type": "string", "required": true },
    { "name": "value", "type": "number", "required": true },
    { "name": "threshold", "type": "number", "required": true, "default": 100 }
  ]
}
```

### Using Template in Job

```json
{
  "artifact_id": "art_abc123",
  "action": "email",
  "schedule": "0 9 * * 1",
  "config": {
    "recipients": ["team@company.com"],
    "template_id": "tpl_xyz789",
    "template_data": {
      "revenue": 125000,
      "growth": 15
    }
  }
}
```

## Related

- [SDK: Templates](../sdk/email.md#templates) - SDK methods
- [REST API: Jobs](jobs.md) - Using templates in scheduled jobs
- [Overview](overview.md) - API intro
