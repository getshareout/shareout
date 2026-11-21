import type { AdminInfo } from '../types';
import type { PWAConfig } from '../../types';
import type { Locale } from '../../i18n';

/** Authenticated viewer profile injected into the sandbox wrapper. */
export interface ViewerUser {
  email: string;
  name: string;
  picture: string;
}

/** Inputs required to render the viewer header and its side panels. */
export interface ToolbarRenderContext {
  showToolbar: boolean;
  loggedIn: boolean;
  isFav: boolean;
  commentsEnabled: boolean;
  /** Who may post without signing in. When `authenticated`, guests only see a login link. */
  commentsIdentityMode: 'anonymous' | 'named' | 'authenticated';
  /** Guest comments are on: a viewer with no account can comment after an email code. */
  commentsGuest: boolean;
  commentCount: number;
  hasMetrics: boolean;
  adminInfo: AdminInfo | null;
  currentUser: ViewerUser | null;
  baseUrl: string;
  slug: string;
  artifactId: string;
  loginRedirect: string;
  /** The page's name, shown in the header. */
  title: string;
  /** Display name of the artifact's owner, for signed-in viewers; null hides it. */
  ownerName: string | null;
  /** Number of the version being viewed, for signed-in viewers; null hides it. */
  versionNo: number | null;
  /** Skills attached to this artifact, shown read-only to any signed-in viewer. Empty for anonymous views. */
  attachedSkills: Array<{ name: string; slug: string }>;
  /** Language the toolbar speaks: the artifact's workspace locale, else the viewer's browser. */
  locale: Locale;
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
