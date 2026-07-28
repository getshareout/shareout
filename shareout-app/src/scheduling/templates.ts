import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { getUserRole } from '../artifacts';
import {
  type TemplateVariable,
  type TemplateVariablesSchema,
  type TemplateContext,
  type RenderedEmail,
  renderTemplate,
  buildTemplateContext,
  validateVariables,
  applyDefaults,
} from './template-renderer';

export type { TemplateVariable, TemplateVariablesSchema, TemplateContext, RenderedEmail };
export { renderTemplate, buildTemplateContext, validateVariables, applyDefaults };

export interface EmailTemplate {
  id: string;
  artifact_id: string | null;
  owner_id: string;
  name: string;
  subject: string;
  html: string;
  text_body: string | null;
  variables_schema: TemplateVariablesSchema;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateRequest {
  name: string;
  subject: string;
  html: string;
  text_body?: string;
  variables?: TemplateVariable[];
  artifact_id?: string;
}

export interface UpdateTemplateRequest {
  name?: string;
  subject?: string;
  html?: string;
  text_body?: string;
  variables?: TemplateVariable[];
}

interface TemplateRow {
  id: string;
  artifact_id: string | null;
  owner_id: string;
  name: string;
  subject: string;
  html: string;
  text_body: string | null;
  variables_schema: string;
  is_system: number;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(row: TemplateRow): EmailTemplate {
  return {
    ...row,
    variables_schema: JSON.parse(row.variables_schema),
    is_system: Boolean(row.is_system),
  };
}

export async function createTemplate(
  env: Env,
  userId: string,
  request: CreateTemplateRequest
): Promise<{ template?: EmailTemplate; error?: string }> {
  if (!request.name || request.name.trim().length === 0) {
    return { error: 'Template name is required' };
  }
  if (!request.subject || request.subject.trim().length === 0) {
    return { error: 'Template subject is required' };
  }
  if (!request.html || request.html.trim().length === 0) {
    return { error: 'Template HTML is required' };
  }
  if (request.name.length > 100) {
    return { error: 'Template name must be 100 characters or less' };
  }
  if (request.subject.length > 200) {
    return { error: 'Template subject must be 200 characters or less' };
  }

  if (request.artifact_id) {
    const role = await getUserRole(env, request.artifact_id, userId);
    if (!role || (role !== 'owner' && role !== 'editor')) {
      return { error: 'Permission denied: must be owner or editor of artifact' };
    }
  }

  const existing = await env.DB.prepare(`
    SELECT id FROM email_templates
    WHERE owner_id = ? AND name = ? AND (artifact_id IS NULL AND ? IS NULL OR artifact_id = ?)
  `).bind(userId, request.name, request.artifact_id || null, request.artifact_id || null).first();

  if (existing) {
    return { error: 'A template with this name already exists' };
  }

  const id = generateId('tpl');
  const variablesSchema: TemplateVariablesSchema = {
    variables: request.variables || [],
  };

  await env.DB.prepare(`
    INSERT INTO email_templates (id, artifact_id, owner_id, name, subject, html, text_body, variables_schema)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    request.artifact_id || null,
    userId,
    request.name.trim(),
    request.subject.trim(),
    request.html,
    request.text_body || null,
    JSON.stringify(variablesSchema)
  ).run();

  const row = await env.DB.prepare('SELECT * FROM email_templates WHERE id = ?')
    .bind(id)
    .first<TemplateRow>();

  return { template: row ? rowToTemplate(row) : undefined };
}

export async function getTemplate(
  env: Env,
  templateId: string,
  userId: string
): Promise<{ template?: EmailTemplate; error?: string }> {
  const row = await env.DB.prepare('SELECT * FROM email_templates WHERE id = ?')
    .bind(templateId)
    .first<TemplateRow>();

  if (!row) {
    return { error: 'Template not found' };
  }

  if (row.owner_id !== userId && !row.is_system) {
    return { error: 'Permission denied' };
  }

  return { template: rowToTemplate(row) };
}

export async function getTemplateForArtifact(
  env: Env,
  templateId: string,
  artifactId: string
): Promise<EmailTemplate | null> {
  const row = await env.DB.prepare(`
    SELECT * FROM email_templates
    WHERE id = ? AND (artifact_id IS NULL OR artifact_id = ? OR is_system = 1)
  `).bind(templateId, artifactId).first<TemplateRow>();

  return row ? rowToTemplate(row) : null;
}

export interface ListTemplatesOptions {
  scope?: 'account' | 'artifact' | 'all';
  artifactId?: string;
}

export async function listTemplates(
  env: Env,
  userId: string,
  options: ListTemplatesOptions = {}
): Promise<EmailTemplate[]> {
  let query = 'SELECT * FROM email_templates WHERE (owner_id = ? OR is_system = 1)';
  const params: (string | null)[] = [userId];

  if (options.scope === 'account') {
    query += ' AND artifact_id IS NULL';
  } else if (options.scope === 'artifact' && options.artifactId) {
    query += ' AND artifact_id = ?';
    params.push(options.artifactId);
  } else if (options.artifactId) {
    query += ' AND (artifact_id IS NULL OR artifact_id = ?)';
    params.push(options.artifactId);
  }

  query += ' ORDER BY name ASC';

  const result = await env.DB.prepare(query).bind(...params).all<TemplateRow>();

  return (result.results || []).map(rowToTemplate);
}

export async function updateTemplate(
  env: Env,
  userId: string,
  templateId: string,
  updates: UpdateTemplateRequest
): Promise<{ template?: EmailTemplate; error?: string }> {
  const row = await env.DB.prepare('SELECT * FROM email_templates WHERE id = ?')
    .bind(templateId)
    .first<TemplateRow>();

  if (!row) {
    return { error: 'Template not found' };
  }

  if (row.owner_id !== userId) {
    return { error: 'Permission denied' };
  }

  if (row.is_system) {
    return { error: 'Cannot modify system templates' };
  }

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) {
    if (updates.name.trim().length === 0) {
      return { error: 'Template name cannot be empty' };
    }
    if (updates.name.length > 100) {
      return { error: 'Template name must be 100 characters or less' };
    }
    sets.push('name = ?');
    params.push(updates.name.trim());
  }

  if (updates.subject !== undefined) {
    if (updates.subject.trim().length === 0) {
      return { error: 'Template subject cannot be empty' };
    }
    if (updates.subject.length > 200) {
      return { error: 'Template subject must be 200 characters or less' };
    }
    sets.push('subject = ?');
    params.push(updates.subject.trim());
  }

  if (updates.html !== undefined) {
    if (updates.html.trim().length === 0) {
      return { error: 'Template HTML cannot be empty' };
    }
    sets.push('html = ?');
    params.push(updates.html);
  }

  if (updates.text_body !== undefined) {
    sets.push('text_body = ?');
    params.push(updates.text_body || null);
  }

  if (updates.variables !== undefined) {
    const schema: TemplateVariablesSchema = { variables: updates.variables };
    sets.push('variables_schema = ?');
    params.push(JSON.stringify(schema));
  }

  if (sets.length === 0) {
    return { error: 'No updates provided' };
  }

  sets.push('updated_at = ?');
  params.push(Math.floor(Date.now() / 1000));
  params.push(templateId);

  await env.DB.prepare(`UPDATE email_templates SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();

  const updated = await env.DB.prepare('SELECT * FROM email_templates WHERE id = ?')
    .bind(templateId)
    .first<TemplateRow>();

  return { template: updated ? rowToTemplate(updated) : undefined };
}

export async function deleteTemplate(
  env: Env,
  userId: string,
  templateId: string
): Promise<{ success: boolean; error?: string }> {
  const row = await env.DB.prepare('SELECT owner_id, is_system FROM email_templates WHERE id = ?')
    .bind(templateId)
    .first<{ owner_id: string; is_system: number }>();

  if (!row) {
    return { success: false, error: 'Template not found' };
  }

  if (row.owner_id !== userId) {
    return { success: false, error: 'Permission denied' };
  }

  if (row.is_system) {
    return { success: false, error: 'Cannot delete system templates' };
  }

  await env.DB.prepare('DELETE FROM email_templates WHERE id = ?').bind(templateId).run();

  return { success: true };
}

export interface PreviewTemplateRequest {
  template_id?: string;
  inline_html?: string;
  inline_subject?: string;
  artifact_id: string;
  data?: Record<string, unknown>;
}

export async function previewTemplate(
  env: Env,
  userId: string,
  request: PreviewTemplateRequest
): Promise<{ rendered?: RenderedEmail; error?: string }> {
  let html: string;
  let subject: string;
  let schema: TemplateVariablesSchema = { variables: [] };

  if (request.template_id) {
    const result = await getTemplate(env, request.template_id, userId);
    if (result.error) {
      return { error: result.error };
    }
    if (!result.template) {
      return { error: 'Template not found' };
    }
    html = result.template.html;
    subject = result.template.subject;
    schema = result.template.variables_schema;
  } else if (request.inline_html && request.inline_subject) {
    html = request.inline_html;
    subject = request.inline_subject;
  } else {
    return { error: 'Either template_id or inline_html/inline_subject required' };
  }

  const artifact = await env.DB.prepare(`
    SELECT a.id, a.name, d.slug AS slug FROM artifacts a
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    WHERE a.id = ?
  `).bind(request.artifact_id).first<{ id: string; name: string; slug: string }>();

  if (!artifact) {
    return { error: 'Artifact not found' };
  }

  const artifactUrl = `${env.SHAREOUT_BASE_URL}/a/${artifact.slug || artifact.id}/`;
  const context = buildTemplateContext({
    id: artifact.id,
    name: artifact.name,
    slug: artifact.slug || artifact.id,
    url: artifactUrl,
  });

  const data = applyDefaults(schema, request.data || {});
  const validation = validateVariables(schema, data);

  const rendered = renderTemplate(html, subject, context, data);

  if (!validation.valid) {
    rendered.warnings = [...(rendered.warnings || []), ...validation.errors];
  }

  return { rendered };
}
