import type { Env } from '../types';
import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  previewTemplate,
  type CreateTemplateRequest,
  type UpdateTemplateRequest,
  type PreviewTemplateRequest,
} from './templates';
import { simpleApiError } from '../http/api-error';

interface AuthenticatedUser {
  id: string;
  email: string | null;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, code: string, status: number): Response {
  return simpleApiError(error, code, status);
}

export async function handleCreateTemplate(
  request: Request,
  env: Env,
  user: AuthenticatedUser
): Promise<Response> {
  let body: CreateTemplateRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 'INVALID_JSON', 400);
  }

  if (!body.name) {
    return errorResponse('name required', 'INVALID_REQUEST', 400);
  }

  if (!body.subject) {
    return errorResponse('subject required', 'INVALID_REQUEST', 400);
  }

  if (!body.html) {
    return errorResponse('html required', 'INVALID_REQUEST', 400);
  }

  const result = await createTemplate(env, user.id, body);

  if (result.error) {
    const status = result.error.includes('Permission') ? 403 : 400;
    return errorResponse(result.error, 'INVALID_REQUEST', status);
  }

  return jsonResponse({ template: result.template }, 201);
}

export async function handleListTemplates(
  request: Request,
  env: Env,
  user: AuthenticatedUser
): Promise<Response> {
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') as 'account' | 'artifact' | 'all' | null;
  const artifactId = url.searchParams.get('artifact_id') || undefined;

  const templates = await listTemplates(env, user.id, {
    scope: scope || undefined,
    artifactId,
  });

  return jsonResponse({ templates, count: templates.length });
}

export async function handleGetTemplate(
  env: Env,
  user: AuthenticatedUser,
  templateId: string
): Promise<Response> {
  const result = await getTemplate(env, templateId, user.id);

  if (result.error) {
    const status = result.error === 'Template not found' ? 404 : 403;
    return errorResponse(result.error, result.error === 'Template not found' ? 'NOT_FOUND' : 'FORBIDDEN', status);
  }

  return jsonResponse({ template: result.template });
}

export async function handleUpdateTemplate(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  templateId: string
): Promise<Response> {
  let body: UpdateTemplateRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 'INVALID_JSON', 400);
  }

  const result = await updateTemplate(env, user.id, templateId, body);

  if (result.error) {
    let status = 400;
    let code = 'INVALID_REQUEST';
    if (result.error === 'Template not found') {
      status = 404;
      code = 'NOT_FOUND';
    } else if (result.error === 'Permission denied' || result.error === 'Cannot modify system templates') {
      status = 403;
      code = 'FORBIDDEN';
    }
    return errorResponse(result.error, code, status);
  }

  return jsonResponse({ template: result.template });
}

export async function handleDeleteTemplate(
  env: Env,
  user: AuthenticatedUser,
  templateId: string
): Promise<Response> {
  const result = await deleteTemplate(env, user.id, templateId);

  if (result.error) {
    let status = 400;
    let code = 'INVALID_REQUEST';
    if (result.error === 'Template not found') {
      status = 404;
      code = 'NOT_FOUND';
    } else if (result.error === 'Permission denied' || result.error === 'Cannot delete system templates') {
      status = 403;
      code = 'FORBIDDEN';
    }
    return errorResponse(result.error, code, status);
  }

  return jsonResponse({ success: true });
}

export async function handlePreviewTemplate(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  templateId?: string
): Promise<Response> {
  let body: Partial<PreviewTemplateRequest>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 'INVALID_JSON', 400);
  }

  if (!body.artifact_id) {
    return errorResponse('artifact_id required', 'INVALID_REQUEST', 400);
  }

  const previewRequest: PreviewTemplateRequest = {
    artifact_id: body.artifact_id,
    data: body.data,
  };

  if (templateId) {
    previewRequest.template_id = templateId;
  } else {
    if (!body.inline_html || !body.inline_subject) {
      return errorResponse('inline_html and inline_subject required for inline preview', 'INVALID_REQUEST', 400);
    }
    previewRequest.inline_html = body.inline_html;
    previewRequest.inline_subject = body.inline_subject;
  }

  const result = await previewTemplate(env, user.id, previewRequest);

  if (result.error) {
    let status = 400;
    let code = 'INVALID_REQUEST';
    if (result.error === 'Template not found' || result.error === 'Artifact not found') {
      status = 404;
      code = 'NOT_FOUND';
    } else if (result.error === 'Permission denied') {
      status = 403;
      code = 'FORBIDDEN';
    }
    return errorResponse(result.error, code, status);
  }

  return jsonResponse({ rendered: result.rendered });
}
