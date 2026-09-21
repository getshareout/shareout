/**
 * Publish a new version of an existing skill from markdown alone.
 *
 * Every write path that is not "the author ran POST /v1/publish again" funnels
 * through here — the in-app editor, a merged change request, the agent's
 * publish_skill tool — so they all produce an ordinary artifact version with the
 * same rules, and ownership stays with the original author whoever pressed save.
 */
import type { Env, FileEntry } from '../types';
import type { AuthUser } from '../api-auth';
import { publishArtifact } from '../publish/publish-artifact';
import type { SkillGovernance } from './policy';

const DEFAULT_ENTRYPOINT = 'skill.md';

/** The path the skill's markdown lives at, so a republish overwrites it in place. */
export async function skillEntrypoint(env: Env, artifactId: string): Promise<string> {
  const row = await env.DB.prepare(
    'SELECT entrypoint FROM versions WHERE artifact_id = ? ORDER BY version_no DESC LIMIT 1'
  ).bind(artifactId).first<{ entrypoint: string }>();
  return row?.entrypoint || DEFAULT_ENTRYPOINT;
}

export interface RepublishResult {
  artifactId: string;
  versionNo: number;
  slug: string;
}

export async function republishSkillMarkdown(
  env: Env,
  actor: AuthUser,
  skill: SkillGovernance,
  markdown: string,
  executionCtx?: ExecutionContext,
): Promise<RepublishResult> {
  const entrypoint = await skillEntrypoint(env, skill.artifactId);
  const files: FileEntry[] = [{ path: entrypoint, content: markdown, mime: 'text/markdown' }];

  const result = await publishArtifact(
    env,
    { id: actor.id, email: actor.email, username: actor.username ?? null },
    {
      name: skill.name,
      slug: skill.displaySlug,
      entrypoint,
      files,
      visibility: 'workspace',
      authMethod: 'google',
      shareWith: [],
      credentials: [],
      workspaceId: skill.workspaceId,
      folderId: null,
      artifactType: 'skill',
      // The caller resolved the grant (policy, or an approved change request);
      // without this the owner/collaborator rule would reject every other author.
      editGrant: true,
    },
    executionCtx,
  );

  return {
    artifactId: result.artifact.id,
    versionNo: result.version.version_no,
    slug: result.deployment.slug,
  };
}
