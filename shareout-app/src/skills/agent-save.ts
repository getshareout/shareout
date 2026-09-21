/**
 * `save_skill` — the agent writing a skill on the user's behalf.
 *
 * Publishing a skill was API-only: a POST with an opaque `wsp_…` id, a files array
 * and a required field the docs mentioned three levels deep. The assistant that
 * already builds pages could not do the one thing users kept asking for — "save that
 * as a skill for the team" — because it had no tool for it.
 *
 * Confirmation is the write-tool rule (see chat-agent/actions.ts): the model proposes,
 * the person taps, and only then does this run — re-resolving permission rather than
 * trusting the stored proposal. Where the skill's policy says changes are reviewed,
 * this opens a change request instead of failing, so the agent's answer is "proposed
 * for review", never "you can't".
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { readSkillMarkdown } from '../skill-marketplace';
import { createSkillFromMarkdown } from './editing';
import { loadSkillGovernance, resolveSkillEditGrant } from './policy';
import { republishSkillMarkdown } from './republish';

export interface SaveSkillInput {
  workspaceId: string;
  name: string;
  markdown: string;
  /** Set to update an existing skill; omitted creates a new one. */
  skillArtifactId?: string;
  category?: string;
}

async function loadActor(env: Env, userId: string): Promise<AuthUser | null> {
  const row = await env.DB.prepare('SELECT id, email, username FROM users WHERE id = ?')
    .bind(userId).first<{ id: string; email: string | null; username: string | null }>();
  return row ? { id: row.id, email: row.email ?? '', username: row.username } : null;
}

/** Runs after the user confirms. Returns the line the agent says back. */
export async function executeSaveSkill(env: Env, userId: string, input: SaveSkillInput): Promise<string> {
  const actor = await loadActor(env, userId);
  if (!actor) return 'I could not confirm who you are, so I did not save anything.';

  if (!(await getInternalWorkspaceRole(env, input.workspaceId, userId))) {
    return 'You are not a member of that workspace, so I can’t save a skill there.';
  }

  if (!input.skillArtifactId) {
    const created = await createSkillFromMarkdown(env, actor, input.workspaceId, {
      name: input.name,
      markdown: input.markdown,
      category: input.category,
    });
    return created.ok
      ? `Saved ✅ “${input.name}” is in your workspace Library → Skills. ${created.url}`
      : `Couldn’t save that skill: ${created.error}`;
  }

  const skill = await loadSkillGovernance(env, input.skillArtifactId);
  if (!skill || skill.blocked) return 'That skill no longer exists.';
  if (skill.official) return 'That is an official ShareOut skill — it’s read-only.';
  if (skill.workspaceId !== input.workspaceId) return 'That skill belongs to a different workspace.';

  const current = await readSkillMarkdown(env, skill.artifactId, skill.latestVersionNo);
  if (current != null && current.trim() === input.markdown.trim()) {
    return `No change — “${skill.name}” already says exactly that.`;
  }

  const grant = await resolveSkillEditGrant(env, userId, skill);
  if (grant) {
    const published = await republishSkillMarkdown(env, actor, skill, input.markdown);
    return `Updated ✅ “${skill.name}” is now at v${published.versionNo}.`;
  }

  if (skill.editPolicy !== 'approval') {
    return `“${skill.name}” can only be changed by its owner. I left it alone.`;
  }

  const changeId = generateId('skc');
  await env.DB.prepare(
    `INSERT INTO skill_change_requests
       (id, skill_artifact_id, workspace_id, proposed_by, base_version_no, title, markdown)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    changeId, skill.artifactId, skill.workspaceId, userId, skill.latestVersionNo,
    `Update from chat`, input.markdown,
  ).run();

  return `“${skill.name}” needs review, so I opened a change request instead. An owner or workspace admin can merge it from the Library.`;
}
