/**
 * Who may change a workspace skill.
 *
 * Editing an artifact means being its owner or an explicit per-email collaborator
 * (src/publish/artifact-upsert.ts), and a workspace admin deliberately gets no
 * content write (src/artifacts/roles.ts). That rule is right for a dashboard and
 * wrong for a team playbook: skills are used as the workspace's source of truth, so
 * the common asks — "everyone keeps this current" and "changes get reviewed" — had
 * no answer, and a departed author left a skill nobody could touch.
 *
 * `edit_policy` answers it per skill:
 *
 * | policy       | who may republish directly        | who may propose |
 * |--------------|-----------------------------------|-----------------|
 * | `owner_only` | owner / artifact editor (default) | nobody          |
 * | `workspace`  | any workspace member              | n/a             |
 * | `approval`   | owner / artifact editor           | any member      |
 *
 * Official (ShareOut-authored) skills are never member-editable, whatever the row says.
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { getUserRole } from '../artifacts/roles';

export type SkillEditPolicy = 'owner_only' | 'workspace' | 'approval';

export const SKILL_EDIT_POLICIES: SkillEditPolicy[] = ['owner_only', 'workspace', 'approval'];

export function parseSkillEditPolicy(raw: unknown): SkillEditPolicy | null {
  return typeof raw === 'string' && (SKILL_EDIT_POLICIES as string[]).includes(raw)
    ? (raw as SkillEditPolicy)
    : null;
}

export interface SkillGovernance {
  artifactId: string;
  workspaceId: string;
  ownerId: string | null;
  slug: string;
  displaySlug: string;
  name: string;
  official: boolean;
  blocked: boolean;
  editPolicy: SkillEditPolicy;
  latestVersionNo: number;
}

/** Skill row + the artifact facts every permission decision here needs. */
export async function loadSkillGovernance(env: Env, skillArtifactId: string): Promise<SkillGovernance | null> {
  const row = await env.DB.prepare(
    `SELECT sm.workspace_id, sm.official, sm.blocked, sm.edit_policy,
            a.owner_id, a.slug, a.display_slug, a.name,
            (SELECT MAX(version_no) FROM versions v WHERE v.artifact_id = a.id) AS latest_version_no
       FROM skill_marketplace sm
       JOIN artifacts a ON a.id = sm.artifact_id
      WHERE sm.artifact_id = ? AND a.deleted_at IS NULL`
  ).bind(skillArtifactId).first<{
    workspace_id: string; official: number; blocked: number; edit_policy: string;
    owner_id: string | null; slug: string; display_slug: string; name: string;
    latest_version_no: number | null;
  }>();
  if (!row) return null;
  return {
    artifactId: skillArtifactId,
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    slug: row.slug,
    displaySlug: row.display_slug || row.slug,
    name: row.name,
    official: !!row.official,
    blocked: !!row.blocked,
    editPolicy: parseSkillEditPolicy(row.edit_policy) ?? 'owner_only',
    latestVersionNo: row.latest_version_no ?? 1,
  };
}

/** The policy a newly published skill starts on, set once by a workspace admin. */
export async function getWorkspaceDefaultSkillPolicy(env: Env, workspaceId: string): Promise<SkillEditPolicy> {
  const row = await env.DB.prepare(
    'SELECT default_skill_edit_policy AS p FROM workspaces WHERE id = ?'
  ).bind(workspaceId).first<{ p: string }>();
  return parseSkillEditPolicy(row?.p) ?? 'owner_only';
}

export type SkillEditGrant =
  | { kind: 'artifact' }      // owner or explicit editor — today's rule
  | { kind: 'workspace' }     // edit_policy = 'workspace' and caller is a member
  | null;

/**
 * May this user republish the skill in place? `null` means no — which under
 * `approval` is the cue to open a change request instead of a 403 dead end.
 */
export async function resolveSkillEditGrant(
  env: Env,
  userId: string,
  skill: SkillGovernance,
): Promise<SkillEditGrant> {
  if (skill.official) return null;
  const role = await getUserRole(env, skill.artifactId, userId);
  if (role === 'owner' || role === 'editor') return { kind: 'artifact' };
  if (skill.editPolicy === 'workspace') {
    const wsRole = await getInternalWorkspaceRole(env, skill.workspaceId, userId);
    if (wsRole) return { kind: 'workspace' };
  }
  return null;
}

/** May this user merge or reject other people's proposed changes? */
export async function canReviewSkillChanges(env: Env, userId: string, skill: SkillGovernance): Promise<boolean> {
  if (skill.official) return false;
  const role = await getUserRole(env, skill.artifactId, userId);
  if (role === 'owner' || role === 'editor') return true;
  const wsRole = await getInternalWorkspaceRole(env, skill.workspaceId, userId);
  return wsRole === 'owner' || wsRole === 'admin';
}

/** May this user change the skill's own edit policy? Owner, or a workspace admin. */
export async function canSetSkillPolicy(env: Env, userId: string, skill: SkillGovernance): Promise<boolean> {
  if (skill.official) return false;
  const role = await getUserRole(env, skill.artifactId, userId);
  if (role === 'owner') return true;
  const wsRole = await getInternalWorkspaceRole(env, skill.workspaceId, userId);
  return wsRole === 'owner' || wsRole === 'admin';
}

/** Can this user see the skill at all (member of its workspace, or it is official)? */
export async function canViewSkill(env: Env, user: AuthUser, skill: SkillGovernance): Promise<boolean> {
  if (skill.official) return true;
  return !!(await getInternalWorkspaceRole(env, skill.workspaceId, user.id));
}

export async function setSkillEditPolicy(env: Env, artifactId: string, policy: SkillEditPolicy): Promise<void> {
  await env.DB.prepare(
    `UPDATE skill_marketplace
        SET edit_policy = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE artifact_id = ?`
  ).bind(policy, artifactId).run();
}
