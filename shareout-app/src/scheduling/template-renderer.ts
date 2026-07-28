export interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'json';
  required: boolean;
  default?: unknown;
  description?: string;
}

export interface TemplateVariablesSchema {
  variables: TemplateVariable[];
}

export interface TemplateContext {
  artifact: {
    id: string;
    name: string;
    url: string;
    slug: string;
  };
  date: string;
  datetime: string;
  timestamp: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text?: string;
  warnings?: string[];
}

const VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function renderTemplate(
  html: string,
  subject: string,
  context: TemplateContext,
  data: Record<string, unknown>
): RenderedEmail {
  const fullContext: Record<string, unknown> = {
    ...context,
    data,
  };
  const warnings: string[] = [];

  const render = (template: string): string => {
    return template.replace(VARIABLE_PATTERN, (_, path: string) => {
      const trimmedPath = path.trim();
      const value = resolvePath(fullContext, trimmedPath);
      if (value === undefined) {
        warnings.push(`Variable not found: ${trimmedPath}`);
        return '';
      }
      return formatValue(value);
    });
  };

  return {
    subject: render(subject),
    html: render(html),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export function buildTemplateContext(artifact: {
  id: string;
  name: string;
  slug: string;
  url: string;
}): TemplateContext {
  const now = new Date();
  return {
    artifact: {
      id: artifact.id,
      name: artifact.name,
      url: artifact.url,
      slug: artifact.slug,
    },
    date: now.toISOString().split('T')[0],
    datetime: now.toISOString(),
    timestamp: Math.floor(now.getTime() / 1000),
  };
}

export function validateVariables(
  schema: TemplateVariablesSchema,
  data: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const variable of schema.variables) {
    const value = data[variable.name];
    if (variable.required && (value === undefined || value === null)) {
      if (variable.default === undefined) {
        errors.push(`Required variable missing: ${variable.name}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function applyDefaults(
  schema: TemplateVariablesSchema,
  data: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...data };

  for (const variable of schema.variables) {
    if ((result[variable.name] === undefined || result[variable.name] === null) && variable.default !== undefined) {
      result[variable.name] = variable.default;
    }
  }

  return result;
}
