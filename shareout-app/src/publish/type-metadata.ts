/**
 * Type metadata and workspace visibility policy for publish.
 */
import type { ArtifactType, Env, FileEntry, TypeMetadata, Visibility } from '../types';
import type { AuthUser } from '../api-auth';
import { generateTypeMetadata } from '../validation';
import {
  DEFAULT_LIBRARY_MAIN,
  resolveLibraryHandle,
  type LibraryScope,
} from '../workspace-library';
import { getWorkspacePublishPolicy, hasApprovedPublish } from '../publish-approval';
import { contentHash } from '../moderation/check';
import type { ExistingArtifactRow, PublishParams, VisibilityPolicyResult } from './types';

/** Skills/library persist as markdown in D1; skill-ness is flagged by sidecar rows. */
export function resolveStoredArtifactType(artifactType: ArtifactType): ArtifactType {
  return (artifactType === 'skill' || artifactType === 'library') ? 'markdown' : artifactType;
}

export async function buildTypeMetadata(
  env: Env,
  params: Pick<PublishParams, 'artifactType' | 'entrypoint' | 'files' | 'slug' | 'library' | 'workspaceId'>,
  user: AuthUser,
): Promise<{ typeMetadata: TypeMetadata; libraryScope: LibraryScope | null }> {
  const { artifactType, entrypoint, files, slug, library, workspaceId } = params;
  const mainFile = files.find(f => f.path === entrypoint) || files[0];
  const typeMetadata: TypeMetadata = mainFile
    ? generateTypeMetadata(artifactType, mainFile.content, mainFile.mime)
    : {};

  let libraryScope: LibraryScope | null = null;
  if (artifactType === 'library' && library) {
    libraryScope = workspaceId ? 'workspace' : 'personal';
    const handle = await resolveLibraryHandle(env, libraryScope, user.id, workspaceId);
    const base = typeMetadata.library ?? { toc: [], hasCodeBlocks: false };
    typeMetadata.library = {
      ...base,
      name: library.name || slug,
      scope: libraryScope,
      namespace: handle ?? undefined,
      version: library.version,
      main: library.main || DEFAULT_LIBRARY_MAIN,
      exports: library.exports,
    };
  }

  return { typeMetadata, libraryScope };
}

/**
 * Workspace publish governance (Phase 1): prohibit open visibility or require
 * teammate approval before public.
 */
export async function applyWorkspaceVisibilityPolicy(
  env: Env,
  visibility: Visibility,
  workspaceId: string | null,
  existing: ExistingArtifactRow | null,
  globalExisting: ExistingArtifactRow | null,
  mainFile: FileEntry | undefined,
): Promise<VisibilityPolicyResult> {
  let effectiveVisibility = visibility;
  let policyNotice: string | undefined;
  let approvalRequired: number | undefined;

  if (visibility === 'public' && workspaceId) {
    const pol = await getWorkspacePublishPolicy(env, workspaceId);
    if (pol.policy === 'prohibit') {
      effectiveVisibility = 'workspace';
      policyNotice = "Your workspace doesn't allow public publishing — kept visible to your workspace.";
    } else if (pol.policy === 'require_approval') {
      const existingId = existing?.id ?? globalExisting?.id ?? null;
      const hash = mainFile?.content ? await contentHash(mainFile.content) : null;
      const approved = existingId ? await hasApprovedPublish(env, existingId, hash) : false;
      if (!approved) {
        effectiveVisibility = 'workspace';
        approvalRequired = pol.approvalsRequired;
        policyNotice = `Your workspace requires approval to publish publicly. Kept visible to your workspace — request approval from ${pol.approvalsRequired} teammate(s).`;
      }
    }
  }

  return { effectiveVisibility, policyNotice, approvalRequired };
}
