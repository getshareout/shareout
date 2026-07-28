/**
 * ShareOut Design System — User Home Page Styles
 *
 * My Pages dashboard: Drive-like artifact browser.
 * Confident-blue brand. Use with baseStyles from shell.ts.
 *
 * Each segment lives in its own file for maintainability.
 *
 * @module design-system/pages/home
 */

import { baseStyles } from './base.css';
import { liquidGlassCanvasTokensStyles } from './liquid-glass-canvas-tokens.css';
import { liquidGlassSurfaceStyles } from './liquid-glass-surface.css';
import { accountPillTopBarFarRightStyles } from './account-pill-top-bar-far-right.css';
import { shellLayoutStyles } from './shell-layout.css';
import { leftRailStyles } from './left-rail.css';
import { workspaceTeamSpaceExpandToItsSharedFoldersInlineStyles } from './workspace-team-space-expand-to-its-shared-folders-inline.css';
import { collapsedRailIconsOnlyStyles } from './collapsed-rail-icons-only.css';
import { mainStyles } from './main.css';
import { stickyTopBarSearchControlsAccountOneRowStyles } from './sticky-top-bar-search-controls-account-one-row.css';
import { toolbarStyles } from './toolbar.css';
import { browserLoadingStyles } from './browser-loading.css';
import { browserGridStyles } from './browser-grid.css';
import { ownerAvatarCardListStyles } from './owner-avatar-card-list.css';
import { browserListTableStyles } from './browser-list-table.css';
import { adminPageWorkspaceStyles } from './admin-page-workspace.css';
import { activityPanelStyles } from './activity-panel.css';
import { recentConversationsFeedStyles } from './recent-conversations-feed.css';
import { analyticsViewStyles } from './analytics-view.css';
import { dataConnectorsStyles } from './data-connectors.css';
import { emptyStateStyles } from './empty-state.css';
import { infiniteScrollSentinelStyles } from './infinite-scroll-sentinel.css';
import { toastStyles } from './toast.css';
import { accessRequestsBannerOwnerInboxOnHomeStyles } from './access-requests-banner-owner-inbox-on-home.css';
import { statsOverlayLiquidGlassStyles } from './stats-overlay-liquid-glass.css';
import { cardTagsStyles } from './card-tags.css';
import { cardSelectionStyles } from './card-selection.css';
import { bulkCommandBarLiquidGlassStyles } from './bulk-command-bar-liquid-glass.css';
import { confirmModalStyles } from './confirm-modal.css';
import { artifactDetailDrawerStyles } from './artifact-detail-drawer.css';
import { workspaceSchedulesAutomationsAdminStyles } from './workspace-schedules-automations-admin.css';
import { richScheduleCardsMySchedulesAdminSchedulesSharedStyles } from './rich-schedule-cards-my-schedules-admin-schedules-shared.css';
import { responsiveStyles } from './responsive.css';
import { linkedAccountsDropdownStyles } from './linked-accounts-dropdown.css';
import { apiTokenSelfServeStyles } from './api-token-self-serve.css';
import { sidebarTagsFilterStyles } from './sidebar-tags-filter.css';
import { tierBadgeStyles } from './tier-badge.css';
import { foldersBarStyles } from './folders-bar.css';
import { folderScopeBadgeDragAndDropStyles } from './folder-scope-badge-drag-and-drop.css';
import { folderContextMenuStyles } from './folder-context-menu.css';
import { folderPickerModalStyles } from './folder-picker-modal.css';
import { interactionPolishStyles } from './interaction-polish.css';
import { iconTooltipsStyles } from './icon-tooltips.css';
import { skillMarketplaceStyles } from './skill-marketplace.css';
import { assetGalleryStyles } from './asset-gallery.css';

/**
 * Ordered CSS sections concatenated for the home page (desktop + shared rules).
 * Mobile layout rules are appended separately via home.mobile.css.ts.
 */
export const homePageComponents = [
  baseStyles,
  liquidGlassCanvasTokensStyles,
  liquidGlassSurfaceStyles,
  accountPillTopBarFarRightStyles,
  shellLayoutStyles,
  leftRailStyles,
  workspaceTeamSpaceExpandToItsSharedFoldersInlineStyles,
  collapsedRailIconsOnlyStyles,
  mainStyles,
  stickyTopBarSearchControlsAccountOneRowStyles,
  toolbarStyles,
  browserLoadingStyles,
  browserGridStyles,
  ownerAvatarCardListStyles,
  browserListTableStyles,
  adminPageWorkspaceStyles,
  activityPanelStyles,
  recentConversationsFeedStyles,
  analyticsViewStyles,
  dataConnectorsStyles,
  emptyStateStyles,
  infiniteScrollSentinelStyles,
  toastStyles,
  accessRequestsBannerOwnerInboxOnHomeStyles,
  statsOverlayLiquidGlassStyles,
  cardTagsStyles,
  cardSelectionStyles,
  bulkCommandBarLiquidGlassStyles,
  confirmModalStyles,
  artifactDetailDrawerStyles,
  workspaceSchedulesAutomationsAdminStyles,
  richScheduleCardsMySchedulesAdminSchedulesSharedStyles,
  responsiveStyles,
  linkedAccountsDropdownStyles,
  apiTokenSelfServeStyles,
  sidebarTagsFilterStyles,
  tierBadgeStyles,
  foldersBarStyles,
  folderScopeBadgeDragAndDropStyles,
  folderContextMenuStyles,
  folderPickerModalStyles,
  interactionPolishStyles,
  iconTooltipsStyles,
  skillMarketplaceStyles,
  assetGalleryStyles,
].join('');
