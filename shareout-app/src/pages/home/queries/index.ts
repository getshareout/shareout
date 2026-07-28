/**
 * D1 queries backing the home grid, sidebar counts, folders, tags, and activity feed.
 *
 * Split from a monolithic `queries.ts` into domain-focused modules; import from
 * `./queries` (this barrel) — all public exports are unchanged.
 */
export type { ActivityFeedOpts } from './shared';
export type { InspectorComment } from './comments';

export {
  queryRecentActivity,
  queryRecentComments,
} from './activity-panels';

export { queryNeedsYou } from './activity-needs-you';
export {
  queryActionItems,
  queryPulse,
  queryActivityFeed,
  queryDismissedEventIds,
  dismissHomeEvents,
  queryWorkspaceActivity,
} from './activity-feed';

export {
  queryForYou,
  recordRecentView,
  queryRecentlyViewed,
  queryHomeArtifacts,
  queryHomeArtifactCatalog,
  queryHomeCounts,
} from './artifacts';

export {
  queryFoldersInParent,
  queryPersonalFolders,
  queryTeamFolders,
  queryFolderPath,
  queryFolderReadme,
} from './folders';

export { queryHomeTags } from './tags';

export {
  queryArtifactComments,
  addArtifactComment,
} from './comments';
