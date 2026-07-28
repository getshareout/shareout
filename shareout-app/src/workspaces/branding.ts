import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { json } from './json-response';
import { requireWorkspaceRole } from './roles';

export interface WorkspaceBranding {
  logo_ext: string | null;
  accent_color: string | null;
  hide_footer: boolean;
}

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const LOGO_MAX_BYTES = 512 * 1024;

const EMPTY_BRANDING: WorkspaceBranding = { logo_ext: null, accent_color: null, hide_footer: false };

export function parseBranding(raw: string | null | undefined): WorkspaceBranding {
  if (!raw) return { ...EMPTY_BRANDING };
  try {
    const b = JSON.parse(raw) as Partial<WorkspaceBranding>;
    return {
      logo_ext: typeof b.logo_ext === 'string' ? b.logo_ext : null,
      accent_color: typeof b.accent_color === 'string' && HEX_COLOR_REGEX.test(b.accent_color) ? b.accent_color : null,
      hide_footer: b.hide_footer === true,
    };
  } catch {
    return { ...EMPTY_BRANDING };
  }
}

async function loadBranding(env: Env, workspaceId: string): Promise<WorkspaceBranding | null> {
  const row = await env.DB.prepare('SELECT branding FROM workspaces WHERE id = ?')
    .bind(workspaceId).first<{ branding: string | null }>();
  if (!row) return null;
  return parseBranding(row.branding);
}

async function saveBranding(env: Env, workspaceId: string, branding: WorkspaceBranding): Promise<void> {
  await env.DB.prepare("UPDATE workspaces SET branding = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .bind(JSON.stringify(branding), workspaceId).run();
}

function brandingResponse(workspaceId: string, b: WorkspaceBranding) {
  return {
    accent_color: b.accent_color,
    hide_footer: b.hide_footer,
    logo_url: b.logo_ext ? `/wl/${workspaceId}.${b.logo_ext}` : null,
  };
}

export async function handleGetWorkspaceBranding(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'member');
  if (forbidden) return forbidden;

  const branding = await loadBranding(env, workspaceId);
  if (!branding) return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);
  return json(brandingResponse(workspaceId, branding));
}

export async function handleUpdateWorkspaceBranding(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  let body: { accent_color?: unknown; hide_footer?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const current = await loadBranding(env, workspaceId);
  if (!current) return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);

  if (body.accent_color !== undefined) {
    if (body.accent_color === null || body.accent_color === '') {
      current.accent_color = null;
    } else if (typeof body.accent_color === 'string' && HEX_COLOR_REGEX.test(body.accent_color)) {
      current.accent_color = body.accent_color.toLowerCase();
    } else {
      return json({ error: 'accent_color must be a #RRGGBB hex value', code: 'INVALID_COLOR' }, 400);
    }
  }

  if (body.hide_footer !== undefined) {
    current.hide_footer = body.hide_footer === true;
  }

  await saveBranding(env, workspaceId, current);
  return json(brandingResponse(workspaceId, current));
}

export async function handleUploadWorkspaceLogo(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  const current = await loadBranding(env, workspaceId);
  if (!current) return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);

  const contentType = request.headers.get('Content-Type') || '';
  const ext = contentType.includes('svg') ? 'svg'
    : contentType.includes('webp') ? 'webp'
    : contentType.includes('png') ? 'png'
    : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
    : '';
  if (!contentType.startsWith('image/') || !ext) {
    return json({ error: 'Logo must be a PNG, JPG, WEBP, or SVG image', code: 'INVALID_CONTENT_TYPE' }, 400);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    return json({ error: 'Empty file', code: 'EMPTY_FILE' }, 400);
  }
  if (body.byteLength > LOGO_MAX_BYTES) {
    return json({ error: 'Logo too large (max 512KB)', code: 'TOO_LARGE' }, 400);
  }

  // Remove a prior logo with a different extension so stale bytes aren't served.
  if (current.logo_ext && current.logo_ext !== ext) {
    await env.ARTIFACTS.delete(`workspace-logos/${workspaceId}.${current.logo_ext}`);
  }

  await env.ARTIFACTS.put(`workspace-logos/${workspaceId}.${ext}`, body, {
    httpMetadata: { contentType, cacheControl: 'public, max-age=86400' },
  });

  current.logo_ext = ext;
  await saveBranding(env, workspaceId, current);
  return json(brandingResponse(workspaceId, current));
}

export async function handleDeleteWorkspaceLogo(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  const current = await loadBranding(env, workspaceId);
  if (!current) return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);

  if (current.logo_ext) {
    await env.ARTIFACTS.delete(`workspace-logos/${workspaceId}.${current.logo_ext}`);
    current.logo_ext = null;
    await saveBranding(env, workspaceId, current);
  }
  return json(brandingResponse(workspaceId, current));
}
