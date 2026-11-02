// REST for one-time view codes: /v1/artifacts/{id}/view-codes[/{codeId}].
import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { requireSharingRole } from '../roles';
import { json } from '../json-response';
import { invalidateDeploymentCacheById } from '../../serve/deployment-cache';
import { loadShareArtifact, shareViewUrl } from '../share-email';
import {
  MAX_CODES_PER_ARTIFACT, MAX_CODES_PER_REQUEST, cleanLabel, countViewCodes, createViewCodes,
  listViewCodes, parseViewSeconds, revokeAllViewCodes, revokeViewCode,
} from './store';

interface ArtifactRow { id: string; artifact_type: string | null; auth_method: string | null; visibility: string | null }

async function loadArtifact(env: Env, artifactId: string): Promise<ArtifactRow | null> {
  return env.DB.prepare('SELECT id, artifact_type, auth_method, visibility FROM artifacts WHERE id = ?')
    .bind(artifactId).first<ArtifactRow>();
}

async function pageUrl(env: Env, artifactId: string): Promise<string | null> {
  const row = await loadShareArtifact(env, artifactId);
  return row ? shareViewUrl(env, row) : null;
}

const notFound = () => json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);

/** GET — every code on the page: who it is for, whether it was opened, what they tried. */
export async function handleListViewCodes(env: Env, user: AuthUser, artifactId: string): Promise<Response> {
  const artifact = await loadArtifact(env, artifactId);
  if (!artifact) return notFound();
  const forbidden = await requireSharingRole(env, artifactId, user.id, 'editor');
  if (forbidden) return forbidden;
  const [codes, url] = await Promise.all([listViewCodes(env, artifactId), pageUrl(env, artifactId)]);
  return json({ enabled: artifact.auth_method === 'onetime', url, view_codes: codes });
}

/**
 * POST `{ recipients: ["Ana", …] | [{ label }], view_seconds? }` — one code per person.
 * Turns the gate on: the page becomes private and opens only with a code (the owner and
 * named collaborators keep their own access). The codes are in this response only.
 */
export async function handleCreateViewCodes(request: Request, env: Env, user: AuthUser, artifactId: string): Promise<Response> {
  let body: { recipients?: unknown; view_seconds?: unknown };
  try { body = await request.json(); } catch {
    return json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400);
  }
  if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
    return json({ error: 'recipients must be a non-empty array of names', code: 'VALIDATION_ERROR', param: 'recipients' }, 400);
  }
  if (body.recipients.length > MAX_CODES_PER_REQUEST) {
    return json({ error: `At most ${MAX_CODES_PER_REQUEST} recipients per request`, code: 'VALIDATION_ERROR', param: 'recipients' }, 400);
  }
  const labels: string[] = [];
  for (const r of body.recipients) {
    const label = cleanLabel(typeof r === 'object' && r !== null ? (r as { label?: unknown }).label : r);
    if (!label) {
      return json({ error: 'Each recipient needs a name — it is the watermark they see', code: 'VALIDATION_ERROR', param: 'recipients' }, 400);
    }
    labels.push(label);
  }
  const viewSeconds = parseViewSeconds(body.view_seconds);
  if (typeof viewSeconds !== 'number') return json({ error: viewSeconds.error, code: 'VALIDATION_ERROR', param: 'view_seconds' }, 400);

  const artifact = await loadArtifact(env, artifactId);
  if (!artifact) return notFound();
  const forbidden = await requireSharingRole(env, artifactId, user.id, 'editor');
  if (forbidden) return forbidden;
  if ((artifact.artifact_type || 'html') !== 'html') {
    return json({ error: 'One-time view works on web pages only', code: 'ONETIME_HTML_ONLY' }, 400);
  }
  if ((await countViewCodes(env, artifactId)) + labels.length > MAX_CODES_PER_ARTIFACT) {
    return json({ error: `A page holds at most ${MAX_CODES_PER_ARTIFACT} codes`, code: 'VIEW_CODE_LIMIT' }, 400);
  }

  if (artifact.auth_method !== 'onetime' || artifact.visibility !== 'private') {
    await env.DB.prepare("UPDATE artifacts SET auth_method = 'onetime', visibility = 'private' WHERE id = ?")
      .bind(artifactId).run();
    // auth_method and visibility ride the deployment cache record.
    await invalidateDeploymentCacheById(env, artifactId);
  }

  const [codes, url] = await Promise.all([
    createViewCodes(env, artifactId, labels, viewSeconds, user.id),
    pageUrl(env, artifactId),
  ]);
  return json({ enabled: true, url, view_seconds: viewSeconds, codes }, 201);
}

/** DELETE /view-codes/{codeId} — that code no longer opens the page. One already open
 *  loses its pass at once; the frame it already loaded still closes with its window. */
export async function handleRevokeViewCode(env: Env, user: AuthUser, artifactId: string, codeId: string): Promise<Response> {
  const artifact = await loadArtifact(env, artifactId);
  if (!artifact) return notFound();
  const forbidden = await requireSharingRole(env, artifactId, user.id, 'editor');
  if (forbidden) return forbidden;
  if (!(await revokeViewCode(env, artifactId, codeId))) {
    return json({ error: 'View code not found', code: 'NOT_FOUND' }, 404);
  }
  return json({ ok: true });
}

/** DELETE /view-codes — turn one-time view off: every code stops working, the page stays private behind sign-in. */
export async function handleDisableViewCodes(env: Env, user: AuthUser, artifactId: string): Promise<Response> {
  const artifact = await loadArtifact(env, artifactId);
  if (!artifact) return notFound();
  const forbidden = await requireSharingRole(env, artifactId, user.id, 'editor');
  if (forbidden) return forbidden;
  await revokeAllViewCodes(env, artifactId);
  if (artifact.auth_method === 'onetime') {
    await env.DB.prepare("UPDATE artifacts SET auth_method = 'google' WHERE id = ? AND auth_method = 'onetime'")
      .bind(artifactId).run();
    await invalidateDeploymentCacheById(env, artifactId);
  }
  return json({ ok: true, enabled: false });
}
