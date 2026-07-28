import type { AdminInfo } from '../types';
import type { PWAConfig } from '../../types';

/** Authenticated viewer profile injected into the sandbox wrapper. */
export interface ViewerUser {
  email: string;
  name: string;
  picture: string;
}

/** Inputs required to render the floating viewer toolbar and overlays. */
export interface ToolbarRenderContext {
  showToolbar: boolean;
  loggedIn: boolean;
  isFav: boolean;
  commentsEnabled: boolean;
  /** Who may post without signing in. When `authenticated`, guests only see a login link. */
  commentsIdentityMode: 'anonymous' | 'named' | 'authenticated';
  commentCount: number;
  hasMetrics: boolean;
  adminInfo: AdminInfo | null;
  currentUser: ViewerUser | null;
  baseUrl: string;
  slug: string;
  artifactId: string;
  loginRedirect: string;
  userLabel: string;
  userFirstName: string;
  avatarInner: string;
  /** False when Live Studio is off for the artifact's workspace (toolbar shows a greyed control). */
  visualEditorEnabled: boolean;
  /** Skills attached to this artifact, shown read-only to any signed-in viewer. Empty for anonymous views. */
  attachedSkills: Array<{ name: string; slug: string }>;
}

/** Result of manifest-aware critical asset resolution. */
export interface ManifestPreloadResult {
  inlinedCSS: string;
  preloadLinks: string;
}

export interface ParsedPwaConfig {
  config: PWAConfig | null;
  tags: string;
}
