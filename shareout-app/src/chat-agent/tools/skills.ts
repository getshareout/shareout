/**
 * Skill tools — browse, read and write the workspace's skill catalog from chat.
 *
 * ShareOut's own assistant could build a page but not save a playbook, which is the
 * thing teams using the Library as their source of truth ask for most. list/read are
 * plain reads; save_skill proposes and waits for a tap like every other write tool.
 */
import type { AccountTool, ToolContext } from './types';
import { PERSONAL_SCOPE } from '../../chat-platforms/types';
import type { PendingAction } from '../actions';
import { readSkillMarkdown } from '../../skill-marketplace';
import { loadSkillGovernance } from '../../skills/policy';
import { getInternalWorkspaceRole } from '../../workspaces/roles';

const NO_WORKSPACE = 'Skills live in a workspace. Pick a workspace first, then ask again.';
/** Enough for the agent to reason over a playbook without flooding the turn. */
const READ_CAP = 20_000;

function workspaceId(ctx: ToolContext): string | null {
  const ws = ctx.selectedWorkspaceId;
  return typeof ws === 'string' && ws !== PERSONAL_SCOPE ? ws : null;
}

export const listSkillsTool: AccountTool = {
  name: 'list_skills',
  description:
    "List the skills (reusable markdown playbooks) published in the current workspace, plus who may edit each one. Use when the user asks what skills the team has, looks for a playbook or convention, or before updating one — the returned id is what save_skill and read_skill take.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optional text to match against name, summary, tags and category.' },
      limit: { type: 'number', description: 'Max skills to return (default 20, max 50).' },
    },
  },
  async execute(ctx, input) {
    const wsId = workspaceId(ctx);
    if (!wsId) return { error: NO_WORKSPACE };
    const q = typeof input.query === 'string' ? input.query.trim() : '';
    const limit = typeof input.limit === 'number' ? Math.min(Math.max(1, input.limit), 50) : 20;

    const filters = ['sm.workspace_id = ?', 'sm.blocked = 0', 'a.deleted_at IS NULL'];
    const binds: unknown[] = [wsId];
    if (q) {
      filters.push('(a.name LIKE ? OR a.type_metadata LIKE ? OR sm.category LIKE ?)');
      binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const rows = await ctx.env.DB.prepare(
      `SELECT a.id, a.name, a.display_slug, a.type_metadata, sm.category, sm.edit_policy,
              (a.owner_id = ?) AS mine,
              (SELECT MAX(version_no) FROM versions v WHERE v.artifact_id = a.id) AS version_no
         FROM skill_marketplace sm JOIN artifacts a ON a.id = sm.artifact_id
        WHERE ${filters.join(' AND ')}
        ORDER BY sm.featured DESC, sm.score DESC, a.name ASC
        LIMIT ?`
    ).bind(ctx.userId, ...binds, limit).all<Record<string, unknown>>();

    return {
      skills: (rows.results ?? []).map((r) => {
        let summary: string | null = null;
        try {
          const meta = r.type_metadata ? JSON.parse(String(r.type_metadata))?.skill : null;
          if (typeof meta?.summary === 'string') summary = meta.summary;
        } catch { /* a card without a summary is still a usable row */ }
        return {
          id: r.id,
          name: r.name,
          slug: r.display_slug,
          summary,
          category: r.category ?? null,
          version: r.version_no ?? 1,
          edit_policy: r.edit_policy ?? 'owner_only',
          yours: !!r.mine,
        };
      }),
    };
  },
};

export const readSkillTool: AccountTool = {
  name: 'read_skill',
  description:
    'Read the full markdown body of one skill by id (from list_skills). Use before answering a question the team has written a playbook for, and always before save_skill on an existing skill so your update builds on the current text instead of replacing it.',
  input_schema: {
    type: 'object',
    properties: { skill_id: { type: 'string', description: 'Skill artifact id from list_skills.' } },
    required: ['skill_id'],
  },
  async execute(ctx, input) {
    const skillId = typeof input.skill_id === 'string' ? input.skill_id.trim() : '';
    if (!skillId) return { error: 'Missing skill_id.' };

    const skill = await loadSkillGovernance(ctx.env, skillId);
    if (!skill || skill.blocked) return { error: 'No such skill.' };
    if (!skill.official && !(await getInternalWorkspaceRole(ctx.env, skill.workspaceId, ctx.userId))) {
      return { error: 'You do not have access to that skill.' };
    }

    const md = await readSkillMarkdown(ctx.env, skillId, skill.latestVersionNo);
    if (md == null) return { error: 'That skill has no readable content.' };
    return {
      id: skillId,
      name: skill.name,
      version: skill.latestVersionNo,
      edit_policy: skill.editPolicy,
      official: skill.official,
      markdown: md.length > READ_CAP ? `${md.slice(0, READ_CAP)}\n\n[truncated]` : md,
    };
  },
};

export const saveSkillTool: AccountTool = {
  name: 'save_skill',
  description:
    "Save markdown as a team skill in the current workspace — a new one, or a new version of an existing one (pass skill_id). Use when the user wants to capture a playbook, convention or how-to for the team to reuse. Read the existing skill first when updating. The user confirms before anything is published; if the skill requires review, this opens a change request instead.",
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short skill title, e.g. "Deploy checklist".' },
      markdown: { type: 'string', description: 'The full skill body in markdown. For an update, the complete new text, not a diff.' },
      skill_id: { type: 'string', description: 'Optional. Update this existing skill instead of creating a new one.' },
      category: { type: 'string', description: 'Optional category for grouping in the Library.' },
    },
    required: ['name', 'markdown'],
  },
  async execute(ctx, input): Promise<{ __propose: PendingAction } | { error: string }> {
    const wsId = workspaceId(ctx);
    if (!wsId) return { error: NO_WORKSPACE };
    const name = String(input.name || '').trim();
    const markdown = String(input.markdown || '').trim();
    if (!name || !markdown) return { error: 'A skill needs both a name and a markdown body.' };

    const skillId = typeof input.skill_id === 'string' ? input.skill_id.trim() : '';
    return {
      __propose: {
        kind: 'save_skill',
        workspaceId: wsId,
        name,
        markdown,
        ...(skillId ? { skillArtifactId: skillId } : {}),
        ...(typeof input.category === 'string' && input.category.trim()
          ? { category: input.category.trim() }
          : {}),
      },
    };
  },
};
