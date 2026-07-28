/**
 * Shared artifact API types.
 *
 * These shapes mirror REST responses for `/v1/artifacts` and related endpoints.
 * Handlers in this package map D1 rows into these interfaces.
 */
import type { ArtifactType, AuthMethod, CollaboratorRole, Visibility } from '../types';

/** Compact artifact row used in list endpoints and workspace catalogs. */
export interface ArtifactSummary {
  id: string;
  name: string;
  slug: string;
  visibility: Visibility;
  paused: boolean;
  created_at: string;
  updated_at: string | null;
  current_version: number;
  user_role?: CollaboratorRole;
  artifact_type: ArtifactType;
  is_favorite?: boolean;
}

/** Full artifact metadata returned by GET `/v1/artifacts/:id`. */
export interface ArtifactDetail extends ArtifactSummary {
  workspace_id: string | null;
  description: string | null;
  social_title: string | null;
  social_description: string | null;
  social_image_url: string | null;
  thumbnail_url: string | null;
  auth_method: AuthMethod;
  viewers: string[];
  url: string;
  embed_url: string;
  embed_allowed: boolean;
  embed_origins: string[] | null;
  /** Present only to owner/workspace-admin when the artifact is held by the
   *  publish-time safety check (Workstream B) — never on approved artifacts. */
  moderation?: {
    status: 'pending' | 'blocked';
    reason: string | null;
    checked_at: string | null;
    message: string;
  };
}

/** One file from a published artifact version (text or base64-encoded binary). */
export interface ArtifactFile {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
  mime: string;
  size_bytes: number;
}

/** Response body for GET `/v1/artifacts/:id/files`. */
export interface ArtifactFilesResponse {
  artifact_id: string;
  version_id: string;
  version_no: number;
  entrypoint: string;
  files: ArtifactFile[];
}
