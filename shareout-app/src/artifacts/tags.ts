/**
 * Artifact label tags (organizational metadata, not access control).
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { requireRole } from './roles';
import { json } from './json-response';

const TAG_MAX_LEN = 32;
const TAG_MAX_PER_ARTIFACT = 12;

function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const label = raw.trim().replace(/\s+/g, ' ').slice(0, TAG_MAX_LEN);
  return label.length ? label : null;
}

export async function handleGetTags(
  _request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const forbidden = await requireRole(env, artifactId, user.id, 'viewer');
  if (forbidden) return forbidden;
  const tags = await env.DB.prepare(
    'SELECT label FROM artifact_tags WHERE artifact_id = ? ORDER BY label COLLATE NOCASE ASC'
  ).bind(artifactId).all<{ label: string }>();
  return json({ tags: (tags.results || []).map(t => t.label) });
}

export async function handleAddTag(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const forbidden = await requireRole(env, artifactId, user.id, 'editor');
  if (forbidden) return forbidden;

  let body: { label?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const label = normalizeTag(body.label);
  if (!label) return json({ error: 'Invalid label', code: 'INVALID_LABEL' }, 400);

  const count = await env.DB.prepare(
    'SELECT COUNT(*) as n FROM artifact_tags WHERE artifact_id = ?'
  ).bind(artifactId).first<{ n: number }>();
  if ((count?.n || 0) >= TAG_MAX_PER_ARTIFACT) {
    return json({ error: 'Too many tags', code: 'TOO_MANY_TAGS' }, 400);
  }

  await env.DB.prepare(
    'INSERT OR IGNORE INTO artifact_tags (id, artifact_id, label) VALUES (?, ?, ?)'
  ).bind(generateId('tag'), artifactId, label).run();

  const tags = await env.DB.prepare(
    'SELECT label FROM artifact_tags WHERE artifact_id = ? ORDER BY label COLLATE NOCASE ASC'
  ).bind(artifactId).all<{ label: string }>();
  return json({ tags: (tags.results || []).map(t => t.label) });
}

export async function handleRemoveTag(
  _request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string,
  label: string
): Promise<Response> {
  const forbidden = await requireRole(env, artifactId, user.id, 'editor');
  if (forbidden) return forbidden;
  await env.DB.prepare(
    'DELETE FROM artifact_tags WHERE artifact_id = ? AND label = ?'
  ).bind(artifactId, label).run();
  return json({ success: true });
}
