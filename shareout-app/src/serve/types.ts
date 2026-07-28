import type { Visibility, AuthMethod, ArtifactType } from '../types';

export interface ArtifactInfo {
  version_id: string;
  entrypoint: string;
  mobile_entrypoint: string | null;
  artifact_id: string;
  artifact_name: string;
  description: string | null;
  social_title: string | null;
  social_description: string | null;
  social_image_url: string | null;
  thumbnail_ext: string | null;
  visibility: Visibility;
  auth_method: AuthMethod;
  owner_id: string | null;
  workspace_id: string | null;
  paused: number;
  has_mobile: number;
  pwa_config: string | null;
  artifact_type: ArtifactType;
  type_metadata: string | null;
  // Per-version, immutable: carried on the combined serve query and the cache
  // record so the sandbox viewer never re-queries them per view.
  access_policy: string | null;
  manifest_json: string | null;
  // Moderation state (Workstream B). Optional: cache records written before this
  // column existed lack it; the serve gate treats undefined as 'approved'.
  moderation_status?: string;
  // Non-null only while a public publish is held private by the safety check
  // (Workstream C): distinguishes a held-from-public page (anon → under-review page)
  // from a plain private page (anon → login gate).
  moderation_held_visibility?: string | null;
}

export interface ArtifactWithAsset extends ArtifactInfo {
  r2_key: string | null;
  mime: string | null;
  size_bytes: number | null;
}

interface EntryAsset {
  r2_key: string;
  mime: string;
  size_bytes: number;
}

export interface CachedDeployment extends ArtifactInfo {
  // The entrypoint asset rows ride the deployment record so a cache-hit
  // entrypoint view needs zero per-view D1 asset queries. Immutable per version.
  entry_asset: EntryAsset | null;
  mobile_entry_asset: EntryAsset | null;
}

export interface EnhancedManifest {
  version: 2;
  entrypoint: string;
  critical: {
    css: string[];
    js: string[];
    fonts: string[];
  };
  assets: Array<{
    path: string;
    mime: string;
    size: number;
    priority: string;
    inlineable: boolean;
  }>;
}

export interface InitialJsonData {
  keys: string[];
  data: Record<string, unknown>;
}

export interface InitialTableData {
  tables: Record<string, { rows: unknown[]; total: number; hasMore: boolean }>;
}

export interface AdminInfo {
  isOwner: boolean;
  role: 'owner' | 'editor' | 'viewer';
  canEdit: boolean;
}

export interface EmbedArtifactInfo extends ArtifactWithAsset {
  embed_allowed: number;
  embed_origins: string | null;
}
