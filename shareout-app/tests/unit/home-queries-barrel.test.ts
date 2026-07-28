/**
 * Verifies the queries barrel re-exports every public symbol consumers rely on.
 * Guards against accidental omissions when splitting modules.
 */
import { describe, expect, it } from 'vitest';
import * as queries from '../../src/pages/home/queries';

const EXPECTED_EXPORTS = [
  'queryRecentActivity',
  'queryRecentComments',
  'queryNeedsYou',
  'queryActionItems',
  'queryPulse',
  'queryActivityFeed',
  'queryDismissedEventIds',
  'dismissHomeEvents',
  'queryWorkspaceActivity',
  'queryForYou',
  'recordRecentView',
  'queryRecentlyViewed',
  'queryHomeArtifacts',
  'queryHomeArtifactCatalog',
  'queryHomeCounts',
  'queryFoldersInParent',
  'queryPersonalFolders',
  'queryTeamFolders',
  'queryFolderPath',
  'queryHomeTags',
  'queryArtifactComments',
  'addArtifactComment',
] as const;

describe('home/queries barrel', () => {
  it('re-exports all public query functions', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(typeof (queries as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
