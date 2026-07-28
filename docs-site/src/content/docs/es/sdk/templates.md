---
title: Templates store
description: Creá y renderizá templates de email reutilizables con interpolación de variables.
---

Templates de email reutilizables con interpolación estilo mustache (`{{variable}}`), usables en jobs programados y métodos de email del SDK. Accedé vía `sdk.templates`.

Los templates pueden estar disponibles para toda la cuenta o restringidos a un artifact específico.

## Métodos

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
  artifactId: string | null;   // null = nivel de cuenta
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
  artifactId?: string;         // omitir para nivel de cuenta
}

interface RenderedEmail {
  subject: string;
  html: string;
  text?: string;
  warnings?: string[];
}
```

## Variables integradas

| Variable | Valor |
|----------|-------|
| `{{artifact.id}}` | ID del artifact |
| `{{artifact.name}}` | Nombre del artifact |
| `{{artifact.url}}` | URL pública |
| `{{artifact.slug}}` | Slug de URL |
| `{{date}}` | Fecha ISO (YYYY-MM-DD) |
| `{{datetime}}` | Datetime ISO |
| `{{timestamp}}` | Unix timestamp |
| `{{data.*}}` | Datos provistos por el usuario |

Los paths anidados funcionan: `{{data.user.email}}`. Las variables que faltan se renderizan como string vacío y aparecen en `warnings`.

## Ejemplos

### Crear un template a nivel de cuenta

```javascript
const sdk = await ShareOut.create();

const tpl = await sdk.templates.create({
  name: 'Reporte Semanal',
  subject: '{{artifact.name}} — {{date}}',
  html: '<h1>{{artifact.name}}</h1><p>Revenue: ${{data.revenue}}</p><p><a href="{{artifact.url}}">Ver</a></p>',
  variables: [
    { name: 'revenue', type: 'number', required: true },
  ],
});
console.log(tpl.id); // tpl_abc123
```

### Previsualizar antes de enviar

```javascript
const rendered = await sdk.templates.preview(tpl.id, sdk._artifactId, {
  revenue: 125000,
});
console.log(rendered.subject); // "Mi Dashboard — 2026-06-17"
```

### Previsualizar inline (sin guardar)

```javascript
const rendered = await sdk.templates.previewInline(
  '<p>Hola, {{data.name}}!</p>',
  'Bienvenido, {{data.name}}',
  sdk._artifactId,
  { name: 'Alice' }
);
```

### Usar en un job programado

Referenciá un template ID en la config de email del job:

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

## Errores

| Code | Status | Descripción |
|------|--------|-------------|
| `NOT_FOUND` | 404 | Template o artifact no encontrado |
| `FORBIDDEN` | 403 | Sin permiso o template del sistema |
| `INVALID_REQUEST` | 400 | Campo faltante o inválido |
