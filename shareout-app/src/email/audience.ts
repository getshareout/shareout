import type { Env } from '../types';

// Audience segmentation: classifies a recipient so the gateway can target a
// template at the right people. The buyer/non-buyer split it was built for is
// moot in a build with no plans, so everyone is INDIVIDUAL.
export type AudienceSegment = 'INDIVIDUAL' | 'TEAM_BILLING' | 'TEAM_MEMBER';

export interface AudienceInfo {
  segment: AudienceSegment;
  isComplimentary: boolean;
}

// The subscriptions/subscription_plans tables this used to join are never written
// in this build — no plans, no billing — so the query always came back empty and
// every recipient resolved to INDIVIDUAL anyway. Two D1 round-trips per lifecycle
// email for a constant.
export async function resolveAudience(_env: Env, _userId: string): Promise<AudienceInfo> {
  return { segment: 'INDIVIDUAL', isComplimentary: false };
}
