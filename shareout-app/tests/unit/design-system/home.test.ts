// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { homePageComponents } from '../../../src/design-system/pages/home/index';
import { homePageStyles } from '../../../src/design-system/pages/home.css';
import { baseStyles } from '../../../src/design-system/pages/home/base.css';
import { liquidGlassCanvasTokensStyles } from '../../../src/design-system/pages/home/liquid-glass-canvas-tokens.css';
import { liquidGlassSurfaceStyles } from '../../../src/design-system/pages/home/liquid-glass-surface.css';
import { accountPillTopBarFarRightStyles } from '../../../src/design-system/pages/home/account-pill-top-bar-far-right.css';
import { shellLayoutStyles } from '../../../src/design-system/pages/home/shell-layout.css';
import { leftRailStyles } from '../../../src/design-system/pages/home/left-rail.css';
import { workspaceTeamSpaceExpandToItsSharedFoldersInlineStyles } from '../../../src/design-system/pages/home/workspace-team-space-expand-to-its-shared-folders-inline.css';
import { collapsedRailIconsOnlyStyles } from '../../../src/design-system/pages/home/collapsed-rail-icons-only.css';
import { mainStyles } from '../../../src/design-system/pages/home/main.css';
import { stickyTopBarSearchControlsAccountOneRowStyles } from '../../../src/design-system/pages/home/sticky-top-bar-search-controls-account-one-row.css';
import { toolbarStyles } from '../../../src/design-system/pages/home/toolbar.css';
import { browserLoadingStyles } from '../../../src/design-system/pages/home/browser-loading.css';
import { browserGridStyles } from '../../../src/design-system/pages/home/browser-grid.css';
import { ownerAvatarCardListStyles } from '../../../src/design-system/pages/home/owner-avatar-card-list.css';
import { browserListTableStyles } from '../../../src/design-system/pages/home/browser-list-table.css';
import { adminPageWorkspaceStyles } from '../../../src/design-system/pages/home/admin-page-workspace.css';
import { activityPanelStyles } from '../../../src/design-system/pages/home/activity-panel.css';
import { recentConversationsFeedStyles } from '../../../src/design-system/pages/home/recent-conversations-feed.css';
import { analyticsViewStyles } from '../../../src/design-system/pages/home/analytics-view.css';
import { dataConnectorsStyles } from '../../../src/design-system/pages/home/data-connectors.css';
import { emptyStateStyles } from '../../../src/design-system/pages/home/empty-state.css';
import { infiniteScrollSentinelStyles } from '../../../src/design-system/pages/home/infinite-scroll-sentinel.css';
import { toastStyles } from '../../../src/design-system/pages/home/toast.css';
import { accessRequestsBannerOwnerInboxOnHomeStyles } from '../../../src/design-system/pages/home/access-requests-banner-owner-inbox-on-home.css';
import { statsOverlayLiquidGlassStyles } from '../../../src/design-system/pages/home/stats-overlay-liquid-glass.css';
import { cardTagsStyles } from '../../../src/design-system/pages/home/card-tags.css';
import { cardSelectionStyles } from '../../../src/design-system/pages/home/card-selection.css';
import { bulkCommandBarLiquidGlassStyles } from '../../../src/design-system/pages/home/bulk-command-bar-liquid-glass.css';
import { confirmModalStyles } from '../../../src/design-system/pages/home/confirm-modal.css';
import { artifactDetailDrawerStyles } from '../../../src/design-system/pages/home/artifact-detail-drawer.css';
import { workspaceSchedulesAutomationsAdminStyles } from '../../../src/design-system/pages/home/workspace-schedules-automations-admin.css';
import { richScheduleCardsMySchedulesAdminSchedulesSharedStyles } from '../../../src/design-system/pages/home/rich-schedule-cards-my-schedules-admin-schedules-shared.css';
import { responsiveStyles } from '../../../src/design-system/pages/home/responsive.css';
import { linkedAccountsDropdownStyles } from '../../../src/design-system/pages/home/linked-accounts-dropdown.css';
import { apiTokenSelfServeStyles } from '../../../src/design-system/pages/home/api-token-self-serve.css';
import { sidebarTagsFilterStyles } from '../../../src/design-system/pages/home/sidebar-tags-filter.css';
import { tierBadgeStyles } from '../../../src/design-system/pages/home/tier-badge.css';
import { foldersBarStyles } from '../../../src/design-system/pages/home/folders-bar.css';
import { folderScopeBadgeDragAndDropStyles } from '../../../src/design-system/pages/home/folder-scope-badge-drag-and-drop.css';
import { folderContextMenuStyles } from '../../../src/design-system/pages/home/folder-context-menu.css';
import { folderPickerModalStyles } from '../../../src/design-system/pages/home/folder-picker-modal.css';
import { interactionPolishStyles } from '../../../src/design-system/pages/home/interaction-polish.css';
import { iconTooltipsStyles } from '../../../src/design-system/pages/home/icon-tooltips.css';
import { skillMarketplaceStyles } from '../../../src/design-system/pages/home/skill-marketplace.css';
import { assetGalleryStyles } from '../../../src/design-system/pages/home/asset-gallery.css';

/** Byte length of the concatenated desktop/shared stylesheet (regression guard). */
const ORIGINAL_STYLE_BYTE_LENGTH = 147281;

/** SHA-256 of the current concatenated CSS body. */
const ORIGINAL_STYLE_SHA256 = 'fd549f1f2ba0cd13daf726f8b1b765275e8a1e85964baac6707e45dd799fe981';

const SECTION_EXPORTS = [
  ['base', baseStyles],
  ['liquid-glass-canvas-tokens', liquidGlassCanvasTokensStyles],
  ['liquid-glass-surface', liquidGlassSurfaceStyles],
  ['account-pill-top-bar-far-right', accountPillTopBarFarRightStyles],
  ['shell-layout', shellLayoutStyles],
  ['left-rail', leftRailStyles],
  ['workspace-team-space-expand-to-its-shared-folders-inline', workspaceTeamSpaceExpandToItsSharedFoldersInlineStyles],
  ['collapsed-rail-icons-only', collapsedRailIconsOnlyStyles],
  ['main', mainStyles],
  ['sticky-top-bar-search-controls-account-one-row', stickyTopBarSearchControlsAccountOneRowStyles],
  ['toolbar', toolbarStyles],
  ['browser-loading', browserLoadingStyles],
  ['browser-grid', browserGridStyles],
  ['owner-avatar-card-list', ownerAvatarCardListStyles],
  ['browser-list-table', browserListTableStyles],
  ['admin-page-workspace', adminPageWorkspaceStyles],
  ['activity-panel', activityPanelStyles],
  ['recent-conversations-feed', recentConversationsFeedStyles],
  ['analytics-view', analyticsViewStyles],
  ['data-connectors', dataConnectorsStyles],
  ['empty-state', emptyStateStyles],
  ['infinite-scroll-sentinel', infiniteScrollSentinelStyles],
  ['toast', toastStyles],
  ['access-requests-banner-owner-inbox-on-home', accessRequestsBannerOwnerInboxOnHomeStyles],
  ['stats-overlay-liquid-glass', statsOverlayLiquidGlassStyles],
  ['card-tags', cardTagsStyles],
  ['card-selection', cardSelectionStyles],
  ['bulk-command-bar-liquid-glass', bulkCommandBarLiquidGlassStyles],
  ['confirm-modal', confirmModalStyles],
  ['artifact-detail-drawer', artifactDetailDrawerStyles],
  ['workspace-schedules-automations-admin', workspaceSchedulesAutomationsAdminStyles],
  ['rich-schedule-cards-my-schedules-admin-schedules-shared', richScheduleCardsMySchedulesAdminSchedulesSharedStyles],
  ['responsive', responsiveStyles],
  ['linked-accounts-dropdown', linkedAccountsDropdownStyles],
  ['api-token-self-serve', apiTokenSelfServeStyles],
  ['sidebar-tags-filter', sidebarTagsFilterStyles],
  ['tier-badge', tierBadgeStyles],
  ['folders-bar', foldersBarStyles],
  ['folder-scope-badge-drag-and-drop', folderScopeBadgeDragAndDropStyles],
  ['folder-context-menu', folderContextMenuStyles],
  ['folder-picker-modal', folderPickerModalStyles],
  ['interaction-polish', interactionPolishStyles],
  ['icon-tooltips', iconTooltipsStyles],
  ['skill-marketplace', skillMarketplaceStyles],
  ['asset-gallery', assetGalleryStyles],
] as const;

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('home page styles', () => {
  it('exports a non-empty stylesheet from the barrel', () => {
    expect(homePageComponents.length).toBe(ORIGINAL_STYLE_BYTE_LENGTH);
    expect(homePageStyles.length).toBeGreaterThan(homePageComponents.length);
  });

  it('includes signature layout and interaction sections', () => {
    expect(homePageComponents).toContain('.shell {');
    expect(homePageComponents).toContain('.artifact-card {');
    expect(homePageComponents).toContain('.detail-drawer {');
    expect(homePageComponents).toContain('.lib-modal {');
    expect(homePageComponents).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('decomposes into focused section modules, each under 1000 lines of source', () => {
    for (const [name, section] of SECTION_EXPORTS) {
      expect(section.length, `${name} should export CSS`).toBeGreaterThan(0);
      const lineCount = section.split('\n').length;
      expect(lineCount, `${name} section source`).toBeLessThanOrEqual(1000);
    }
  });

  it('preserves the original monolithic CSS body byte-for-byte', async () => {
    expect(homePageComponents.length).toBe(ORIGINAL_STYLE_BYTE_LENGTH);
    expect(await sha256(homePageComponents)).toBe(ORIGINAL_STYLE_SHA256);
  });
});
