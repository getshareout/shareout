export interface ShareOutOptions {
  artifactId?: string;
  baseUrl?: string;
  sessionToken?: string;
  cache?: boolean;
  cacheTTL?: number;
  batchDelay?: number;
}

export interface DataResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface ViewerIdentity {
  /** Collaborator role for this artifact. Anonymous/unmatched viewers are 'viewer'. */
  role: 'owner' | 'editor' | 'viewer';
  /** True for the artifact owner. */
  isOwner: boolean;
  /** True when the viewer may edit (owner or editor). */
  canEdit: boolean;
  /** The signed-in viewer's email, or null when anonymous. */
  email: string | null;
  /** The signed-in viewer's display name, or null. */
  name: string | null;
}
