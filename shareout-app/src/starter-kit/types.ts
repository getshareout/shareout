import type { Visibility, AgentPublishConfig } from '../types';

/** Which kit an artifact belongs to. */
export type KitTier = 'personal' | 'team';

/**
 * One pre-loaded example artifact. Authored as a self-contained single HTML file
 * that embeds the ShareOut SDK and explains the feature it demonstrates. Seeded
 * into a new account's personal space (tier 'personal') or a new team workspace
 * (tier 'team').
 */
export interface StarterArtifact {
  /** Human/display slug. Stable — drives idempotent re-seed (display_slug + owner). */
  slug: string;
  name: string;
  /** One line shown in the home card + the in-artifact banner. */
  description: string;
  /** Feature this example teaches, e.g. "so.table". Shown in the banner pill. */
  feature: string;
  tier: KitTier;
  /** Full index.html. */
  html: string;
  /** Defaults to 'private' (personal) / 'workspace' (team) when omitted. */
  visibility?: Visibility;
  /** Visitor AI agent config, applied at publish (e.g. the Ask-AI example). */
  agent?: AgentPublishConfig;
}
