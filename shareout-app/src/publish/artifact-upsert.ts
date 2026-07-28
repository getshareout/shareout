/**
 * Artifact row create/update during publish — matches by human slug (display_slug),
 * reuses routing slug on re-publish, allocates a new routing slug for new artifacts.
 */
import type { ArtifactType, AuthMethod, Env, PWAConfig, TypeMetadata, Visibility } from '../types';
import type { AuthUser } from '../api-auth';
import { getUserRole } from '../artifacts';
import { generateId } from '../crypto-utils';
import { hashPassword } from './request-auth';
import { allocateRoutingSlug } from './routing-slug';
import type { ExistingArtifactRow } from './types';
import { setPresentation, type PresentationFields } from '../artifacts/satellites';

export interface ArtifactUpsertResult {
  artifactId: string;
  versionNo: number;
  routingSlug: string;
}

export interface ArtifactUpsertInput {
  slug: string;
  name: string;
  effectiveVisibility: Visibility;
  authMethod: AuthMethod;
  password?: string;
  workspaceId: string | null;
  folderId: string | null;
  hasMobile: boolean;
  pwa?: PWAConfig;
  storedType: ArtifactType;
  typeMetadata: TypeMetadata;
  accessPolicyJson: string | null;
  isExample?: boolean;
  embed?: { allowed?: boolean; origins?: string[] };
}

async function assertCanEdit(env: Env, artifactId: string, ownerId: string | null, userId: string): Promise<void> {
  if (ownerId && ownerId !== userId) {
    const role = await getUserRole(env, artifactId, userId);
    if (role !== 'editor' && role !== 'owner') {
      throw new Error('FORBIDDEN');
    }
  }
}

async function nextVersionNo(env: Env, artifactId: string): Promise<number> {
  const lastVersion = await env.DB.prepare(
    'SELECT MAX(version_no) as max_v FROM versions WHERE artifact_id = ?'
  ).bind(artifactId).first<{ max_v: number }>();
  return (lastVersion?.max_v || 0) + 1;
}

async function updateArtifactRow(
  env: Env,
  artifactId: string,
  input: ArtifactUpsertInput,
  passwordHash: string | null,
): Promise<void> {
  const { effectiveVisibility, authMethod, workspaceId, folderId, hasMobile, pwa, storedType, typeMetadata, accessPolicyJson, embed } = input;
  // Password: clear the hash when auth isn't 'password' (explicit opt-out); otherwise
  // keep the existing hash on a republish that doesn't resend the password (COALESCE),
  // so protection isn't silently wiped.
  const clearPassword = authMethod !== 'password' ? 1 : 0;
  await env.DB.prepare(
    'UPDATE artifacts SET visibility = ?, auth_method = ?, password_hash = CASE WHEN ? THEN NULL ELSE COALESCE(?, password_hash) END, workspace_id = ?, folder_id = COALESCE(?, folder_id), artifact_type = ?, type_metadata = ?, access_policy = COALESCE(?, access_policy) WHERE id = ?'
  ).bind(
    effectiveVisibility, authMethod, clearPassword, passwordHash, workspaceId, folderId,
    storedType, JSON.stringify(typeMetadata), accessPolicyJson, artifactId,
  ).run();

  // Embed: a publish that doesn't mention embed leaves the existing setting alone —
  // omitting the key is what preserves it (the old SQL used COALESCE for this).
  const presentation: PresentationFields = {
    has_mobile: hasMobile ? 1 : 0,
    pwa_config: pwa ? JSON.stringify(pwa) : null,
  };
  if (embed?.allowed !== undefined) presentation.embed_allowed = embed.allowed !== false ? 1 : 0;
  if (embed?.origins) presentation.embed_origins = JSON.stringify(embed.origins);
  await setPresentation(env, artifactId, presentation);
}

export async function findExistingArtifacts(
  env: Env,
  slug: string,
  workspaceId: string | null,
  ownerId: string,
): Promise<{ existing: ExistingArtifactRow | null; globalExisting: ExistingArtifactRow | null }> {
  const existing = await env.DB.prepare(
    'SELECT id, owner_id, workspace_id, slug FROM artifacts WHERE display_slug = ? AND workspace_id = ? AND deleted_at IS NULL'
  ).bind(slug, workspaceId).first<ExistingArtifactRow>();

  const globalExisting = await env.DB.prepare(
    'SELECT id, owner_id, slug FROM artifacts WHERE display_slug = ? AND workspace_id IS NULL AND owner_id = ? AND deleted_at IS NULL'
  ).bind(slug, ownerId).first<ExistingArtifactRow>();

  return { existing, globalExisting };
}

export async function upsertArtifactRecord(
  env: Env,
  user: AuthUser,
  input: ArtifactUpsertInput,
  existing: ExistingArtifactRow | null,
  globalExisting: ExistingArtifactRow | null,
): Promise<ArtifactUpsertResult> {
  const passwordHash = input.password ? await hashPassword(input.password) : null;

  if (existing) {
    await assertCanEdit(env, existing.id, existing.owner_id, user.id);
    await updateArtifactRow(env, existing.id, input, passwordHash);
    return {
      artifactId: existing.id,
      routingSlug: existing.slug,
      versionNo: await nextVersionNo(env, existing.id),
    };
  }

  if (globalExisting) {
    await assertCanEdit(env, globalExisting.id, globalExisting.owner_id, user.id);
    await updateArtifactRow(env, globalExisting.id, input, passwordHash);
    return {
      artifactId: globalExisting.id,
      routingSlug: globalExisting.slug,
      versionNo: await nextVersionNo(env, globalExisting.id),
    };
  }

  const artifactId = generateId('art');
  const routingSlug = await allocateRoutingSlug(env, input.slug, input.workspaceId, user.id);
  const embedAllowed = input.embed?.allowed !== false ? 1 : 0;
  const embedOrigins = input.embed?.origins ? JSON.stringify(input.embed.origins) : null;

  await env.DB.prepare(
    'INSERT INTO artifacts (id, name, slug, display_slug, visibility, auth_method, password_hash, owner_id, workspace_id, folder_id, artifact_type, type_metadata, access_policy, is_example) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    artifactId, input.name, routingSlug, input.slug, input.effectiveVisibility,
    input.authMethod, passwordHash, user.id, input.workspaceId, input.folderId,
    input.storedType, JSON.stringify(input.typeMetadata),
    input.accessPolicyJson, input.isExample ? 1 : 0,
  ).run();

  await setPresentation(env, artifactId, {
    has_mobile: input.hasMobile ? 1 : 0,
    pwa_config: input.pwa ? JSON.stringify(input.pwa) : null,
    embed_allowed: embedAllowed,
    embed_origins: embedOrigins,
  });

  return { artifactId, routingSlug, versionNo: 1 };
}
