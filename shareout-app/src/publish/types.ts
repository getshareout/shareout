/**
 * Shared types for the artifact publish pipeline.
 *
 * The publish flow turns a bundle of files + metadata into a versioned artifact:
 * D1 rows (artifact, version, assets), R2 blobs, deployment pointer, and an
 * enhanced manifest that classifies critical vs lazy assets for the runtime.
 */
import type {
  AgentPublishConfig,
  ArtifactType,
  AuthMethod,
  Credential,
  LibraryPublishConfig,
  PWAConfig,
  Visibility,
  FileEntry,
} from '../types';
import type { ArtifactSdkPin, CapabilityContract } from '@shareout/types';

/** Load priority used in the enhanced manifest for runtime preloading. */
export type AssetPriority = 'critical' | 'high' | 'normal' | 'lazy';

/** Per-file metadata stored in the version manifest. */
export interface AssetMetadata {
  path: string;
  mime: string;
  size: number;
  priority: AssetPriority;
  inlineable: boolean;
}

/**
 * Version manifest v2 — records entrypoint, critical asset lists, and SDK pins
 * (ADR 29) so the serve path can preload CSS/JS/fonts efficiently.
 */
export interface EnhancedManifest {
  version: 2;
  entrypoint: string;
  created: string;
  critical: {
    css: string[];
    js: string[];
    fonts: string[];
  };
  assets: AssetMetadata[];
  mobile?: {
    entrypoint: string;
  };
  sdk?: ArtifactSdkPin;
  capabilityContract?: CapabilityContract;
}

/**
 * Normalized input to {@link publishArtifact} — shared by the token API,
 * session /create flow, starter kit, and library module authoring.
 */
export interface PublishParams {
  name: string;
  slug: string;
  entrypoint: string;
  files: FileEntry[];
  visibility: Visibility;
  authMethod: AuthMethod;
  shareWith: string[];
  password?: string;
  credentials: Credential[];
  workspaceId: string | null;
  /** Target workspace is a public showcase → bypass the open-visibility launch gate. */
  allowOpen?: boolean;
  folderId: string | null;
  mobileHtml?: string;
  mobileEntrypoint?: string;
  pwa?: PWAConfig;
  embed?: {
    allowed?: boolean;
    origins?: string[];
  };
  accessPolicy?: unknown;
  agent?: AgentPublishConfig;
  artifactType: ArtifactType;
  attachedSkillIds?: string[];
  isExample?: boolean;
  library?: LibraryPublishConfig;
}

/** Result of workspace publish-governance checks applied during publish. */
export interface VisibilityPolicyResult {
  effectiveVisibility: Visibility;
  policyNotice?: string;
  approvalRequired?: number;
}

/** Existing artifact row matched by display_slug (human slug), if any. */
export interface ExistingArtifactRow {
  id: string;
  owner_id: string | null;
  workspace_id?: string | null;
  slug: string;
}
