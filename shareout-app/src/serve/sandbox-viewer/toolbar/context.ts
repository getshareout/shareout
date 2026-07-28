import { escapeHtml } from '../../utils';
import type { AdminInfo } from '../../types';
import type { ToolbarRenderContext, ViewerUser } from '../types';

interface BuildToolbarContextInput {
  loggedIn: boolean;
  isFav: boolean;
  commentsEnabled: boolean;
  commentsIdentityMode?: 'anonymous' | 'named' | 'authenticated';
  commentCount: number;
  hasMetrics: boolean;
  adminInfo: AdminInfo | null;
  currentUser: ViewerUser | null;
  hideToolbar: boolean;
  baseUrl: string;
  slug: string;
  artifactId: string;
  visualEditorEnabled: boolean;
  attachedSkills: Array<{ name: string; slug: string }>;
}

/** Derive display fields and visibility flags for toolbar rendering. */
export function buildToolbarContext(input: BuildToolbarContextInput): ToolbarRenderContext | null {
  const {
    loggedIn,
    isFav,
    commentsEnabled,
    commentsIdentityMode = 'anonymous',
    commentCount,
    hasMetrics,
    adminInfo,
    currentUser,
    hideToolbar,
    baseUrl,
    slug,
    artifactId,
    visualEditorEnabled,
    attachedSkills,
  } = input;

  if (hideToolbar) return null;

  const showToolbar = loggedIn || commentsEnabled;
  if (!showToolbar) return null;

  const loginRedirect = `/a/${slug}/`;
  const userInitials = currentUser
    ? (currentUser.name || currentUser.email || '?').trim().slice(0, 2).toUpperCase()
    : '';
  const userLabel = currentUser ? (currentUser.name || currentUser.email) : '';
  const userFirstName = currentUser
    ? (currentUser.name ? currentUser.name.trim().split(/\s+/)[0] : currentUser.email.split('@')[0])
    : '';
  const avatarInner = currentUser
    ? (currentUser.picture
      ? `<img src="${escapeHtml(currentUser.picture)}" alt="" class="so-avatar-img" referrerpolicy="no-referrer">`
      : `<span class="so-avatar-fallback">${escapeHtml(userInitials)}</span>`)
    : '';

  return {
    showToolbar,
    loggedIn,
    isFav,
    commentsEnabled,
    commentsIdentityMode,
    commentCount,
    hasMetrics,
    adminInfo,
    currentUser,
    baseUrl,
    slug,
    artifactId,
    loginRedirect,
    userLabel,
    userFirstName,
    avatarInner,
    visualEditorEnabled,
    attachedSkills,
  };
}
