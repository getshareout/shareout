import type { Env } from '../types';

function on(v: string | undefined): boolean {
  const s = (v || '').toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/** Hard pause for every catalog email, OTP and invites included. Jobs + CrewAI
 *  use sendArtifactEmail and are unaffected. */
export function lifecycleEmailsDisabled(env: Env): boolean {
  return on(env.LIFECYCLE_EMAILS_DISABLED);
}

/** Unsolicited nurture mail we push at users on a timer — win-back, activation
 *  nudges, first-view, weekly digests. Opt-IN: unset means off, so a var that
 *  gets dropped in a refactor can never silently resume the sends. Transactional
 *  and event-driven mail (OTP, invites, comment notifications) is unaffected. */
export function nurtureEmailsEnabled(env: Env): boolean {
  return on(env.NURTURE_EMAILS_ENABLED);
}
