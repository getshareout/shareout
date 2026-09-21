import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';
import {
  canReviewSkillChanges,
  canSetSkillPolicy,
  canViewSkill,
  getWorkspaceDefaultSkillPolicy,
  loadSkillGovernance,
  parseSkillEditPolicy,
  resolveSkillEditGrant,
  setSkillEditPolicy,
} from '../../../src/skills/policy';
import {
  handleListSkillChanges,
  handleProposeSkillChange,
  handleReviewSkillChange,
} from '../../../src/skills/changes';
import { handleGetSkillRaw } from '../../../src/skills/install';
import {
  handleAttachAgentSkill,
  handleGetSkillMarkdown,
  handleListAgentSkills,
  handleSyncAgentSkill,
} from '../../../src/skill-marketplace';

const e = env as unknown as Env;

const WS = 'wsp_skills';
const OWNER = 'usr_owner';
const ADMIN = 'usr_admin';
const MEMBER = 'usr_member';
const EDITOR = 'usr_editor';   // workspace member + artifact-level editor on SK_OWNER
const OUTSIDER = 'usr_out';

const SK_OWNER = 'art_owner_only';
const SK_WS = 'art_ws_editable';
const SK_APPROVAL = 'art_approval';
const SK_OFFICIAL = 'art_official';

const user = (id: string): AuthUser => ({ id, email: `${id}@example.com`, username: null });

const SKILL_BODY = '---\nsummary: How we ship\ncategory: Eng\n---\n\n# Deploy checklist\n\nStep one.\n';

beforeAll(async () => {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, username TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, slug TEXT, default_skill_edit_policy TEXT NOT NULL DEFAULT 'owner_only')`,
    `CREATE TABLE IF NOT EXISTS workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, role TEXT, member_class TEXT NOT NULL DEFAULT 'internal')`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, display_slug TEXT, owner_id TEXT, workspace_id TEXT, description TEXT, type_metadata TEXT, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS collaborators (id TEXT PRIMARY KEY, artifact_id TEXT, email TEXT, role TEXT)`,
    `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, artifact_id TEXT, version_no INTEGER, entrypoint TEXT)`,
    `CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, version_id TEXT, path TEXT, r2_key TEXT, mime TEXT)`,
    `CREATE TABLE IF NOT EXISTS skill_marketplace (artifact_id TEXT PRIMARY KEY, workspace_id TEXT, category TEXT, upvote_count INTEGER DEFAULT 0, install_count INTEGER DEFAULT 0, attach_count INTEGER DEFAULT 0, use_count INTEGER DEFAULT 0, score REAL DEFAULT 0, blocked INTEGER DEFAULT 0, featured INTEGER DEFAULT 0, official INTEGER DEFAULT 0, content_hash TEXT, official_rank INTEGER DEFAULT 0, edit_policy TEXT NOT NULL DEFAULT 'owner_only', published_at TEXT DEFAULT '2026-01-01T00:00:00.000Z', updated_at TEXT DEFAULT '2026-01-01T00:00:00.000Z')`,
    `CREATE TABLE IF NOT EXISTS skill_change_requests (id TEXT PRIMARY KEY, skill_artifact_id TEXT, workspace_id TEXT, proposed_by TEXT, reviewed_by TEXT, base_version_no INTEGER, title TEXT, note TEXT, markdown TEXT, status TEXT NOT NULL DEFAULT 'open', review_note TEXT, merged_version_no INTEGER, created_at TEXT DEFAULT '2026-01-01T00:00:00.000Z', updated_at TEXT DEFAULT '2026-01-01T00:00:00.000Z')`,
    `CREATE TABLE IF NOT EXISTS workspace_agent_skills (workspace_id TEXT, user_id TEXT, skill_artifact_id TEXT, skill_version_no INTEGER, position INTEGER DEFAULT 0, created_at TEXT DEFAULT '2026-01-01T00:00:00.000Z', PRIMARY KEY (workspace_id, user_id, skill_artifact_id))`,
    `CREATE TABLE IF NOT EXISTS skill_votes (artifact_id TEXT, user_id TEXT, PRIMARY KEY (artifact_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS skill_installs (artifact_id TEXT, user_id TEXT, PRIMARY KEY (artifact_id, user_id))`,
  ];
  for (const sql of ddl) await e.DB.exec(sql);

  for (const t of ['users', 'workspaces', 'workspace_members', 'artifacts', 'collaborators',
    'versions', 'assets', 'skill_marketplace', 'skill_change_requests', 'workspace_agent_skills']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }

  for (const id of [OWNER, ADMIN, MEMBER, EDITOR, OUTSIDER]) {
    await e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(id, `${id}@example.com`).run();
  }
  await e.DB.prepare(
    "INSERT INTO workspaces (id, name, owner_id, slug, default_skill_edit_policy) VALUES (?, 'W', ?, 'w', 'workspace')"
  ).bind(WS, OWNER).run();
  const roles: [string, string][] = [[OWNER, 'owner'], [ADMIN, 'admin'], [MEMBER, 'member'], [EDITOR, 'member']];
  for (const [uid, role] of roles) {
    await e.DB.prepare(
      "INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES (?, ?, ?, ?, 'internal')"
    ).bind(`wsm_${uid}`, WS, uid, role).run();
  }

  const skills: [string, string, string, number][] = [
    [SK_OWNER, 'Deploy checklist', 'owner_only', 0],
    [SK_WS, 'Team glossary', 'workspace', 0],
    [SK_APPROVAL, 'Security review', 'approval', 0],
    [SK_OFFICIAL, 'ShareOut', 'owner_only', 1],
  ];
  for (const [id, name, policy, official] of skills) {
    const slug = id.replace('art_', '');
    await e.DB.prepare(
      'INSERT INTO artifacts (id, name, slug, display_slug, owner_id, workspace_id, type_metadata) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, name, slug, slug, OWNER, WS, JSON.stringify({ skill: { summary: 'How we ship' } })).run();
    await e.DB.prepare(
      'INSERT INTO skill_marketplace (artifact_id, workspace_id, edit_policy, official) VALUES (?, ?, ?, ?)'
    ).bind(id, WS, policy, official).run();
    await e.DB.prepare(
      'INSERT INTO versions (id, artifact_id, version_no, entrypoint) VALUES (?, ?, 1, ?)'
    ).bind(`ver_${id}_1`, id, 'skill.md').run();
  }

  // Real bytes for every skill, so the read path is exercised end to end.
  for (const [id] of skills) {
    await e.ARTIFACTS.put(`skills/${id}-1.md`, SKILL_BODY);
    await e.DB.prepare('INSERT INTO assets (id, version_id, path, r2_key, mime) VALUES (?, ?, ?, ?, ?)')
      .bind(`ast_${id}_1`, `ver_${id}_1`, 'skill.md', `skills/${id}-1.md`, 'text/markdown').run();
  }

  await e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES (?, ?, ?, 'editor')")
    .bind('col_1', SK_OWNER, `${EDITOR}@example.com`).run();
});

describe('parseSkillEditPolicy', () => {
  it('accepts the three policies and rejects anything else', () => {
    expect(parseSkillEditPolicy('owner_only')).toBe('owner_only');
    expect(parseSkillEditPolicy('workspace')).toBe('workspace');
    expect(parseSkillEditPolicy('approval')).toBe('approval');
    expect(parseSkillEditPolicy('anyone')).toBeNull();
    expect(parseSkillEditPolicy(null)).toBeNull();
  });
});

describe('loadSkillGovernance', () => {
  it('reads the policy, ownership and current version', async () => {
    const g = await loadSkillGovernance(e, SK_WS);
    expect(g).toMatchObject({ workspaceId: WS, ownerId: OWNER, editPolicy: 'workspace', latestVersionNo: 1, official: false });
  });

  it('returns null for an unknown id', async () => {
    expect(await loadSkillGovernance(e, 'art_nope')).toBeNull();
  });
});

describe('resolveSkillEditGrant', () => {
  it('owner_only: only the owner and an artifact editor may republish', async () => {
    const g = (await loadSkillGovernance(e, SK_OWNER))!;
    expect(await resolveSkillEditGrant(e, OWNER, g)).toEqual({ kind: 'artifact' });
    expect(await resolveSkillEditGrant(e, EDITOR, g)).toEqual({ kind: 'artifact' });
    expect(await resolveSkillEditGrant(e, ADMIN, g)).toBeNull();
    expect(await resolveSkillEditGrant(e, MEMBER, g)).toBeNull();
    expect(await resolveSkillEditGrant(e, OUTSIDER, g)).toBeNull();
  });

  it('workspace: any internal member may republish, an outsider may not', async () => {
    const g = (await loadSkillGovernance(e, SK_WS))!;
    expect(await resolveSkillEditGrant(e, MEMBER, g)).toEqual({ kind: 'workspace' });
    expect(await resolveSkillEditGrant(e, ADMIN, g)).toEqual({ kind: 'workspace' });
    expect(await resolveSkillEditGrant(e, OWNER, g)).toEqual({ kind: 'artifact' });
    expect(await resolveSkillEditGrant(e, OUTSIDER, g)).toBeNull();
  });

  it('approval: a member gets no direct grant — that is the cue to propose', async () => {
    const g = (await loadSkillGovernance(e, SK_APPROVAL))!;
    expect(await resolveSkillEditGrant(e, MEMBER, g)).toBeNull();
    expect(await resolveSkillEditGrant(e, OWNER, g)).toEqual({ kind: 'artifact' });
  });

  it('an official skill is never member-editable, whatever the row says', async () => {
    const g = (await loadSkillGovernance(e, SK_OFFICIAL))!;
    expect(await resolveSkillEditGrant(e, OWNER, g)).toBeNull();
    expect(await canReviewSkillChanges(e, OWNER, g)).toBe(false);
    expect(await canSetSkillPolicy(e, OWNER, g)).toBe(false);
  });
});

describe('review and policy permissions', () => {
  it('owner, artifact editor and workspace admin may review; a plain member may not', async () => {
    const g = (await loadSkillGovernance(e, SK_APPROVAL))!;
    expect(await canReviewSkillChanges(e, OWNER, g)).toBe(true);
    expect(await canReviewSkillChanges(e, ADMIN, g)).toBe(true);
    expect(await canReviewSkillChanges(e, MEMBER, g)).toBe(false);
    expect(await canReviewSkillChanges(e, OUTSIDER, g)).toBe(false);
  });

  it('only the owner or a workspace admin may change the policy', async () => {
    const g = (await loadSkillGovernance(e, SK_OWNER))!;
    expect(await canSetSkillPolicy(e, OWNER, g)).toBe(true);
    expect(await canSetSkillPolicy(e, ADMIN, g)).toBe(true);
    expect(await canSetSkillPolicy(e, EDITOR, g)).toBe(false);
    expect(await canSetSkillPolicy(e, MEMBER, g)).toBe(false);
  });

  it('setSkillEditPolicy persists', async () => {
    await setSkillEditPolicy(e, SK_OFFICIAL, 'approval');
    expect((await loadSkillGovernance(e, SK_OFFICIAL))!.editPolicy).toBe('approval');
    await setSkillEditPolicy(e, SK_OFFICIAL, 'owner_only');
  });

  it('a workspace default is what a new skill would be born with', async () => {
    expect(await getWorkspaceDefaultSkillPolicy(e, WS)).toBe('workspace');
    expect(await getWorkspaceDefaultSkillPolicy(e, 'wsp_missing')).toBe('owner_only');
  });

  it('canViewSkill tracks membership, and is always true for official', async () => {
    const g = (await loadSkillGovernance(e, SK_WS))!;
    expect(await canViewSkill(e, user(MEMBER), g)).toBe(true);
    expect(await canViewSkill(e, user(OUTSIDER), g)).toBe(false);
    expect(await canViewSkill(e, user(OUTSIDER), (await loadSkillGovernance(e, SK_OFFICIAL))!)).toBe(true);
  });
});

function post(body: unknown): Request {
  return new Request('https://x/', { method: 'POST', body: JSON.stringify(body) });
}

describe('change requests', () => {
  it('a member may propose on an approval skill', async () => {
    const res = await handleProposeSkillChange(post({ markdown: '# New body', note: 'clarify step 2' }), e, user(MEMBER), SK_APPROVAL);
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; status: string; base_version_no: number };
    expect(body.status).toBe('open');
    expect(body.base_version_no).toBe(1);
  });

  it('an outsider may not propose', async () => {
    const res = await handleProposeSkillChange(post({ markdown: '# Nope' }), e, user(OUTSIDER), SK_APPROVAL);
    expect(res.status).toBe(403);
  });

  it('an official skill refuses proposals outright', async () => {
    const res = await handleProposeSkillChange(post({ markdown: '# Nope' }), e, user(MEMBER), SK_OFFICIAL);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'SKILL_OFFICIAL_READONLY' });
  });

  it('rejects an empty body and one identical to the current version', async () => {
    expect((await handleProposeSkillChange(post({ markdown: '   ' }), e, user(MEMBER), SK_APPROVAL)).status).toBe(400);
    const same = await handleProposeSkillChange(post({ markdown: SKILL_BODY }), e, user(MEMBER), SK_OWNER);
    expect(same.status).toBe(400);
    expect(await same.json()).toMatchObject({ code: 'NO_CHANGE' });
  });

  it('lists the queue and tells the caller whether they may review', async () => {
    const asMember = await handleListSkillChanges(new Request('https://x/'), e, user(MEMBER), SK_APPROVAL);
    const memberBody = await asMember.json() as { changes: unknown[]; can_review: boolean };
    expect(memberBody.changes.length).toBeGreaterThan(0);
    expect(memberBody.can_review).toBe(false);

    const asAdmin = await handleListSkillChanges(new Request('https://x/'), e, user(ADMIN), SK_APPROVAL);
    expect(await asAdmin.json()).toMatchObject({ can_review: true });
  });

  it('a plain member cannot reject somebody else’s proposal', async () => {
    const created = await (await handleProposeSkillChange(post({ markdown: '# Another' }), e, user(MEMBER), SK_APPROVAL)).json() as { id: string };
    const res = await handleReviewSkillChange(post({ action: 'reject' }), e, user(MEMBER), SK_APPROVAL, created.id);
    expect(res.status).toBe(403);
  });

  it('an admin rejects, and the request cannot be reviewed twice', async () => {
    const created = await (await handleProposeSkillChange(post({ markdown: '# Third' }), e, user(MEMBER), SK_APPROVAL)).json() as { id: string };
    const rejected = await handleReviewSkillChange(post({ action: 'reject', review_note: 'out of scope' }), e, user(ADMIN), SK_APPROVAL, created.id);
    expect(await rejected.json()).toMatchObject({ status: 'rejected' });

    const again = await handleReviewSkillChange(post({ action: 'reject' }), e, user(ADMIN), SK_APPROVAL, created.id);
    expect(again.status).toBe(409);
  });

  it('the proposer may withdraw their own request; a bystander may not', async () => {
    const created = await (await handleProposeSkillChange(post({ markdown: '# Fourth' }), e, user(MEMBER), SK_APPROVAL)).json() as { id: string };
    expect((await handleReviewSkillChange(post({ action: 'withdraw' }), e, user(EDITOR), SK_APPROVAL, created.id)).status).toBe(403);
    const ok = await handleReviewSkillChange(post({ action: 'withdraw' }), e, user(MEMBER), SK_APPROVAL, created.id);
    expect(await ok.json()).toMatchObject({ status: 'withdrawn' });
  });

  it('rejects an unknown action', async () => {
    const created = await (await handleProposeSkillChange(post({ markdown: '# Fifth' }), e, user(MEMBER), SK_APPROVAL)).json() as { id: string };
    expect((await handleReviewSkillChange(post({ action: 'yolo' }), e, user(ADMIN), SK_APPROVAL, created.id)).status).toBe(400);
  });
});

describe('GET /v1/skills/:id/raw', () => {
  it('serves markdown with the frontmatter an Agent Skills client reads', async () => {
    const res = await handleGetSkillRaw(e, user(MEMBER), SK_OWNER);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');
    expect(res.headers.get('X-Skill-Version')).toBe('1');
    const text = await res.text();
    expect(text).toContain('name: owner-only');
    expect(text).toContain('description: How we ship');
    expect(text).toContain('category: Eng');
    expect(text).toContain('# Deploy checklist');
  });

  it('never caches a workspace skill at the edge', async () => {
    const res = await handleGetSkillRaw(e, user(MEMBER), SK_OWNER);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('401s an anonymous caller on a workspace skill, 403s a non-member', async () => {
    expect((await handleGetSkillRaw(e, null, SK_OWNER)).status).toBe(401);
    expect((await handleGetSkillRaw(e, user(OUTSIDER), SK_OWNER)).status).toBe(403);
  });
});

describe('agent skill version pinning', () => {
  it('flags an attachment that is behind the published version, then re-pins it', async () => {
    await e.DB.prepare(
      'INSERT OR REPLACE INTO workspace_agent_skills (workspace_id, user_id, skill_artifact_id, skill_version_no) VALUES (?, ?, ?, 1)'
    ).bind(WS, MEMBER, SK_WS).run();
    await e.DB.prepare('INSERT INTO versions (id, artifact_id, version_no, entrypoint) VALUES (?, ?, 2, ?)')
      .bind(`ver_${SK_WS}_2`, SK_WS, 'skill.md').run();
    await e.ARTIFACTS.put(`skills/${SK_WS}-2.md`, SKILL_BODY);
    await e.DB.prepare('INSERT INTO assets (id, version_id, path, r2_key, mime) VALUES (?, ?, ?, ?, ?)')
      .bind(`ast_${SK_WS}_2`, `ver_${SK_WS}_2`, 'skill.md', `skills/${SK_WS}-2.md`, 'text/markdown').run();

    const before = await (await handleListAgentSkills(e, user(MEMBER), WS)).json() as {
      skills: Array<{ skill_artifact_id: string; version_no: number; latest_version_no: number; outdated: boolean }>;
    };
    const stale = before.skills.find(s => s.skill_artifact_id === SK_WS)!;
    expect(stale).toMatchObject({ version_no: 1, latest_version_no: 2, outdated: true });

    const synced = await handleSyncAgentSkill(e, user(MEMBER), WS, SK_WS);
    expect(await synced.json()).toMatchObject({ version_no: 2, previous_version_no: 1 });

    const after = await (await handleListAgentSkills(e, user(MEMBER), WS)).json() as {
      skills: Array<{ skill_artifact_id: string; outdated: boolean }>;
    };
    expect(after.skills.find(s => s.skill_artifact_id === SK_WS)!.outdated).toBe(false);
  });

  it('404s when the skill is not attached', async () => {
    expect((await handleSyncAgentSkill(e, user(MEMBER), WS, SK_APPROVAL)).status).toBe(404);
  });
});

describe('a workspace member can actually use a teammate’s skill', () => {
  // Regression: assertSkillUsable asked for an artifact collaborator role, so viewing
  // or attaching a colleague's workspace skill 403'd for everyone but its author.
  it('reads the markdown of a skill they do not own', async () => {
    const res = await handleGetSkillMarkdown(e, user(MEMBER), SK_OWNER);
    expect(res.status).toBe(200);
    const body = await res.json() as { markdown: string; html: string; version_no: number; can_edit: boolean; edit_policy: string };
    expect(body.markdown).toContain('# Deploy checklist');
    expect(body.html).toContain('<h1>Deploy checklist</h1>');
    expect(body.version_no).toBe(1);
    expect(body.can_edit).toBe(false);
    expect(body.edit_policy).toBe('owner_only');
  });

  it('attaches it to their own agent', async () => {
    const res = await handleAttachAgentSkill(post({ skill_artifact_id: SK_OWNER }), e, user(MEMBER), WS);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skill_artifact_id: SK_OWNER, version_no: 1 });
  });

  it('still refuses a non-member', async () => {
    expect((await handleGetSkillMarkdown(e, user(OUTSIDER), SK_OWNER)).status).toBe(403);
    expect((await handleAttachAgentSkill(post({ skill_artifact_id: SK_OWNER }), e, user(OUTSIDER), WS)).status).toBe(403);
  });

  it('tells the owner they can edit, and a member under review that they can propose', async () => {
    const asOwner = await (await handleGetSkillMarkdown(e, user(OWNER), SK_OWNER)).json() as { can_edit: boolean; can_set_policy: boolean };
    expect(asOwner).toMatchObject({ can_edit: true, can_set_policy: true });

    const asMember = await (await handleGetSkillMarkdown(e, user(MEMBER), SK_APPROVAL)).json() as { can_edit: boolean; can_propose: boolean };
    expect(asMember).toMatchObject({ can_edit: false, can_propose: true });

    const onWsSkill = await (await handleGetSkillMarkdown(e, user(MEMBER), SK_WS)).json() as { can_edit: boolean; can_propose: boolean };
    expect(onWsSkill).toMatchObject({ can_edit: true, can_propose: false });
  });
});
