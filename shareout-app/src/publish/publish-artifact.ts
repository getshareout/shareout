/**
 * Core publish orchestrator — wires artifact upsert, asset storage, manifest,
 * moderation, deployment, and response assembly.
 */
import type { Env, PublishResponse } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { coerceVisibility } from '../visibility-config';
import { upsertSkillMarketplaceRow, attachSkillsAtPublish } from '../skill-marketplace';
import { recordLibraryVersion, upsertLibraryModuleRow } from '../workspace-library';
import type { TypeMetadata } from '../types';
import { upsertAgentConfig } from './agent-config';
import { storeVersionAssets } from './assets';
import { syncCredentials, syncViewers } from './request-auth';
import {
  assemblePublishResponse,
  buildWorkspaceUrls,
  isFirstPublishForUser,
  promoteVersion,
  schedulePostPublishTasks,
} from './deployment';
import { enrichHtmlArtifact } from './html-enrichment';
import { buildEnhancedManifest } from './manifest';
import { runPublishModeration } from './moderation';
import { findExistingArtifacts, upsertArtifactRecord } from './artifact-upsert';
import { applyWorkspaceVisibilityPolicy, buildTypeMetadata, resolveStoredArtifactType } from './type-metadata';
import type { PublishParams } from './types';

export async function publishArtifact(
  env: Env,
  user: AuthUser,
  params: PublishParams,
  executionCtx?: ExecutionContext,
): Promise<PublishResponse> {
  const {
    name, slug, entrypoint, files, authMethod, shareWith, password, credentials,
    workspaceId, folderId, mobileHtml, mobileEntrypoint, pwa, embed, accessPolicy,
    agent, artifactType, attachedSkillIds, isExample, library,
  } = params;

  const visibility = coerceVisibility(env, params.visibility, params.allowOpen ?? false);
  const hasMobile = !!mobileHtml;
  const accessPolicyJson = accessPolicy ? JSON.stringify(accessPolicy) : null;
  const storedType = resolveStoredArtifactType(artifactType);
  const mainFile = files.find(f => f.path === entrypoint) || files[0];

  const { typeMetadata, libraryScope } = await buildTypeMetadata(env, params, user);
  const { existing, globalExisting } = await findExistingArtifacts(env, slug, workspaceId, user.id);
  const { effectiveVisibility, policyNotice, approvalRequired } = await applyWorkspaceVisibilityPolicy(
    env, visibility, workspaceId, existing, globalExisting, mainFile,
  );

  const firstPublish = await isFirstPublishForUser(env, user.id);

  const { artifactId, versionNo, routingSlug } = await upsertArtifactRecord(
    env, user,
    {
      slug, name, effectiveVisibility, authMethod, password, workspaceId, folderId,
      hasMobile, pwa, storedType, typeMetadata, accessPolicyJson, isExample, embed,
    },
    existing, globalExisting,
  );

  await syncMarketplaceSidecars(env, user, {
    artifactId, artifactType, workspaceId, typeMetadata,
    attachedSkillIds, libraryScope, versionNo,
  });

  if (authMethod === 'google' && shareWith.length > 0) {
    await syncViewers(env, artifactId, shareWith);
  }
  if (authMethod === 'credentials' && credentials.length > 0) {
    await syncCredentials(env, artifactId, credentials);
  }
  if (agent !== undefined) {
    await upsertAgentConfig(env, artifactId, agent);
  }

  const versionId = generateId('ver');
  const actualMobileEntrypoint = hasMobile ? (mobileEntrypoint || 'mobile.html') : null;

  await env.DB.prepare(
    'INSERT INTO versions (id, artifact_id, version_no, entrypoint, mobile_entrypoint, manifest_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(versionId, artifactId, versionNo, entrypoint, actualMobileEntrypoint, '{}').run();

  const assetMetadata = await storeVersionAssets(
    env, versionId, artifactId, versionNo, files, mobileHtml, actualMobileEntrypoint,
  );

  const manifest = buildEnhancedManifest(entrypoint, assetMetadata, actualMobileEntrypoint);
  await env.DB.prepare('UPDATE versions SET manifest_json = ? WHERE id = ?')
    .bind(JSON.stringify(manifest), versionId).run();

  const editorReadiness = mainFile?.content
    ? await enrichHtmlArtifact(env, artifactId, mainFile.content, user, artifactType)
    : undefined;

  const moderation = mainFile?.content
    ? await runPublishModeration(env, artifactId, mainFile.content, effectiveVisibility, executionCtx)
    : { status: 'approved' as const, forcedPrivate: false };

  const blocking = await promoteVersion(env, artifactId, versionId, routingSlug);

  const baseUrl = env.SHAREOUT_BASE_URL.replace(/\/$/, '');
  const workspaceUrls = await buildWorkspaceUrls(env, baseUrl, workspaceId, folderId, slug);
  const publicUrl = workspaceUrls.subdomainUrl || `${baseUrl}/a/${routingSlug}/`;

  schedulePostPublishTasks(env, user, executionCtx, {
    artifactId, artifactType, versionId, workspaceId, routingSlug,
    blocking, firstPublish, name, publicUrl,
  });

  return assemblePublishResponse(env, {
    artifactId, artifactType, versionId, versionNo, routingSlug,
    humanSlug: slug, name, hasMobile, pwa, workspaceUrls,
    editorReadiness,
    moderationStatus: moderation.status,
    moderationReason: moderation.reason,
    policyNotice, approvalRequired, blocking,
  });
}

async function syncMarketplaceSidecars(
  env: Env,
  user: AuthUser,
  opts: {
    artifactId: string;
    artifactType: PublishParams['artifactType'];
    workspaceId: string | null;
    typeMetadata: TypeMetadata;
    attachedSkillIds?: string[];
    libraryScope: 'personal' | 'workspace' | null;
    versionNo: number;
  },
): Promise<void> {
  const { artifactId, artifactType, workspaceId, typeMetadata, attachedSkillIds, libraryScope, versionNo } = opts;

  if (artifactType === 'skill' && workspaceId) {
    const skillMeta = typeMetadata.skill;
    await upsertSkillMarketplaceRow(env, artifactId, workspaceId, skillMeta?.category ?? null);
  }
  if (attachedSkillIds && attachedSkillIds.length > 0 && artifactType !== 'skill') {
    await attachSkillsAtPublish(env, artifactId, workspaceId, attachedSkillIds, user.id);
  }
  if (artifactType === 'library' && libraryScope) {
    const libMeta = typeMetadata.library;
    if (libMeta?.namespace && libMeta.name && libMeta.version && libMeta.main) {
      await upsertLibraryModuleRow(env, {
        artifactId, scope: libraryScope, ownerId: user.id, workspaceId,
        namespace: libMeta.namespace, moduleName: libMeta.name,
        version: libMeta.version, mainPath: libMeta.main,
      });
      await recordLibraryVersion(env, artifactId, libMeta.version, versionNo, libMeta.main);
    }
  }
}
