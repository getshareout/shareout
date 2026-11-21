import type { AdminInfo } from '../../types';
import type { ToolbarRenderContext, ViewerUser } from '../types';
import type { Locale } from '../../../i18n';

interface BuildToolbarContextInput {
  loggedIn: boolean;
  isFav: boolean;
  commentsEnabled: boolean;
  commentsIdentityMode?: 'anonymous' | 'named' | 'authenticated';
  commentsGuest?: boolean;
  commentCount: number;
  hasMetrics: boolean;
  adminInfo: AdminInfo | null;
  currentUser: ViewerUser | null;
  hideToolbar: boolean;
  baseUrl: string;
  slug: string;
  artifactId: string;
  attachedSkills: Array<{ name: string; slug: string }>;
  locale?: Locale;
  title: string;
  ownerName?: string | null;
  versionNo?: number | null;
}

/** Derive display fields and visibility flags for toolbar rendering. */
export function buildToolbarContext(input: BuildToolbarContextInput): ToolbarRenderContext | null {
  const {
    loggedIn,
    isFav,
    commentsEnabled,
    commentsIdentityMode = 'anonymous',
    commentsGuest = false,
    commentCount,
    hasMetrics,
    adminInfo,
    currentUser,
    hideToolbar,
    baseUrl,
    slug,
    artifactId,
    attachedSkills,
    locale = 'en',
    title,
    ownerName = null,
    versionNo = null,
  } = input;

  if (hideToolbar) return null;

  const showToolbar = loggedIn || commentsEnabled;
  if (!showToolbar) return null;

  const loginRedirect = `/a/${slug}/`;

  return {
    showToolbar,
    loggedIn,
    isFav,
    commentsEnabled,
    commentsIdentityMode,
    commentsGuest,
    commentCount,
    hasMetrics,
    adminInfo,
    currentUser,
    baseUrl,
    slug,
    artifactId,
    loginRedirect,
    attachedSkills,
    title,
    // Owner and version are team context: never shown to a viewer without an account.
    ownerName: loggedIn ? ownerName : null,
    versionNo: loggedIn ? versionNo : null,
    locale,
  };
}
