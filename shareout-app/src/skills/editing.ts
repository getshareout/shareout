/**
 * Create and edit skills from a session — the in-app authoring path.
 *
 * Until now the only way to get a skill into a workspace was `POST /v1/publish` with
 * `artifact_type: "skill"`, an opaque `wsp_…` id and a files array. The Library had no
 * button. These handlers are the same publish underneath with a shape a form (or an
 * agent holding a body of markdown) can actually send: a name and some markdown.
 */
import type { Env, FileEntry } from '../types';
import type { AuthUser } from '../api-auth';
import { generateSlug } from '../validation';
import { json } from '../artifacts/json-response';
import { createLogger, logError } from '../logging';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { publishArtifact } from '../publish/publish-artifact';
import { readSkillMarkdown } from '../skill-marketplace';
import {
  canSetSkillPolicy,
  loadSkillGovernance,
  parseSkillEditPolicy,
  resolveSkillEditGrant,
  setSkillEditPolicy,
} from './policy';
import { republishSkillMarkdown } from './republish';

const MAX_MARKDOWN = 60_000;
const SKILL_ENTRYPOINT = 'skill.md';

export interface CreateSkillInput {
  name: string;
  markdown: string;
  slug?: string;
  category?: string;
}

export type CreateSkillResult =
  | { ok: true; artifactId: string; versionNo: number; slug: string; url: string }
  | { ok: false; status: number; code: string; error: string; hint?: string };

/**
 * Publish a brand-new skill. Shared by the Library form, the REST route and the
 * agent's save_skill tool so all three enforce the same rules and produce the same
 * artifact shape.
 */
export async function createSkillFromMarkdown(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  input: CreateSkillInput,
  executionCtx?: ExecutionContext,
): Promise<CreateSkillResult> {
  if (!(await getInternalWorkspaceRole(env, workspaceId, user.id))) {
    return { ok: false, status: 403, code: 'FORBIDDEN', error: 'Workspace not found or access denied' };
  }

  const name = (input.name ?? '').trim();
  const markdown = (input.markdown ?? '').trim();
  if (!name) return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'name is required' };
  if (!markdown) return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'markdown is required' };
  if (markdown.length > MAX_MARKDOWN) {
    return { ok: false, status: 400, code: 'SKILL_TOO_LARGE', error: `Skill body exceeds ${MAX_MARKDOWN} characters` };
  }

  const slug = (input.slug ?? '').trim() || generateSlug(name);
  const existing = await env.DB.prepare(
    'SELECT id FROM artifacts WHERE display_slug = ? AND workspace_id = ? AND deleted_at IS NULL'
  ).bind(slug, workspaceId).first<{ id: string }>();
  if (existing) {
    return {
      ok: false, status: 409, code: 'SLUG_TAKEN',
      error: `A page with the slug "${slug}" already exists in this workspace`,
      hint: 'Pick a different name, or edit the existing skill instead of creating a new one.',
    };
  }

  const files: FileEntry[] = [{
    path: SKILL_ENTRYPOINT,
    content: withCategory(markdown, (input.category ?? '').trim()),
    mime: 'text/markdown',
  }];

  try {
    const result = await publishArtifact(env, user, {
      name, slug, entrypoint: SKILL_ENTRYPOINT, files,
      visibility: 'workspace', authMethod: 'google', shareWith: [], credentials: [],
      workspaceId, folderId: null, artifactType: 'skill',
    }, executionCtx);
    return {
      ok: true,
      artifactId: result.artifact.id,
      versionNo: result.version.version_no,
      slug: result.deployment.slug,
      url: result.deployment.subdomain_url || result.deployment.url,
    };
  } catch (err) {
    logError(createLogger(env, { scope: 'skills', event: 'skill.create.failed' }), 'skill publish failed', err);
    return { ok: false, status: 500, code: 'INTERNAL_ERROR', error: 'Internal server error' };
  }
}

// POST /v1/workspaces/:workspaceId/skills — publish a new skill from markdown.
export async function handleCreateSkill(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  executionCtx?: ExecutionContext,
): Promise<Response> {
  let body: CreateSkillInput;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  const result = await createSkillFromMarkdown(env, user, workspaceId, body, executionCtx);
  if (!result.ok) {
    return json({ error: result.error, code: result.code, ...(result.hint ? { hint: result.hint } : {}) }, result.status);
  }
  return json({
    artifact_id: result.artifactId,
    version_no: result.versionNo,
    slug: result.slug,
    url: result.url,
  }, 201);
}

/** Add `category:` to the frontmatter when the form supplied one and the body has none. */
function withCategory(markdown: string, category: string): string {
  if (!category) return markdown;
  const fm = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fm) return `---\ncategory: ${category}\n---\n\n${markdown}`;
  if (/^category\s*:/m.test(fm[1])) return markdown;
  return `---\ncategory: ${category}\n${fm[1]}\n---\n${markdown.slice(fm[0].length)}`;
}

// PUT /v1/skills/:id/markdown — save a new version of an existing skill.
export async function handleUpdateSkillMarkdown(
  request: Request,
  env: Env,
  user: AuthUser,
  skillId: string,
  executionCtx?: ExecutionContext,
): Promise<Response> {
  const skill = await loadSkillGovernance(env, skillId);
  if (!skill || skill.blocked) return json({ error: 'Skill not found', code: 'NOT_FOUND' }, 404);
  if (skill.official) {
    return json({ error: 'Official skills are read-only', code: 'SKILL_OFFICIAL_READONLY' }, 400);
  }

  let body: { markdown?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }
  const markdown = (body.markdown ?? '').trim();
  if (!markdown) return json({ error: 'markdown is required', code: 'BAD_REQUEST' }, 400);
  if (markdown.length > MAX_MARKDOWN) {
    return json({ error: `Skill body exceeds ${MAX_MARKDOWN} characters`, code: 'SKILL_TOO_LARGE' }, 400);
  }

  const grant = await resolveSkillEditGrant(env, user.id, skill);
  if (!grant) {
    const member = await getInternalWorkspaceRole(env, skill.workspaceId, user.id);
    // Under 'approval' a member is not forbidden — they are being routed to the
    // review flow, so say that instead of dead-ending on a 403.
    if (member && skill.editPolicy === 'approval') {
      return json({
        error: 'This skill requires an approved change request',
        code: 'SKILL_REQUIRES_APPROVAL',
        hint: `POST /v1/skills/${skillId}/changes with your markdown to propose it.`,
      }, 409);
    }
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const current = await readSkillMarkdown(env, skillId, skill.latestVersionNo);
  if (current != null && current.trim() === markdown) {
    return json({ version_no: skill.latestVersionNo, unchanged: true });
  }

  try {
    const published = await republishSkillMarkdown(env, user, skill, markdown, executionCtx);
    return json({ artifact_id: skill.artifactId, version_no: published.versionNo, via: grant.kind });
  } catch (err) {
    logError(createLogger(env, { scope: 'skills', event: 'skill.update.failed' }), 'skill update failed', err);
    return json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

// PUT /v1/skills/:id/policy — who may change this skill from now on.
export async function handleSetSkillPolicy(
  request: Request,
  env: Env,
  user: AuthUser,
  skillId: string,
): Promise<Response> {
  const skill = await loadSkillGovernance(env, skillId);
  if (!skill) return json({ error: 'Skill not found', code: 'NOT_FOUND' }, 404);
  if (!(await canSetSkillPolicy(env, user.id, skill))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  let body: { edit_policy?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }
  const policy = parseSkillEditPolicy(body.edit_policy);
  if (!policy) {
    return json({
      error: "edit_policy must be 'owner_only', 'workspace' or 'approval'",
      code: 'BAD_REQUEST',
    }, 400);
  }

  await setSkillEditPolicy(env, skillId, policy);
  return json({ artifact_id: skillId, edit_policy: policy });
}

// PUT /v1/workspaces/:workspaceId/skill-policy — the policy new skills start on.
// Existing skills keep whatever they were set to; this is the house default, not a
// retroactive sweep, so an admin cannot silently reopen somebody's locked skill.
export async function handleSetWorkspaceSkillPolicy(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (role !== 'owner' && role !== 'admin') return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);

  let body: { default_skill_edit_policy?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }
  const policy = parseSkillEditPolicy(body.default_skill_edit_policy);
  if (!policy) {
    return json({
      error: "default_skill_edit_policy must be 'owner_only', 'workspace' or 'approval'",
      code: 'BAD_REQUEST',
    }, 400);
  }

  await env.DB.prepare('UPDATE workspaces SET default_skill_edit_policy = ? WHERE id = ?')
    .bind(policy, workspaceId).run();
  return json({ workspace_id: workspaceId, default_skill_edit_policy: policy });
}
