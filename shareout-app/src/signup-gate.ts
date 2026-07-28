import type { Env } from './types';

export const SIGNUPS_PAUSED_MSG = 'New account sign-ups are paused right now. Please check back soon.';

export function signupsPaused(env: Env): boolean {
  const v = (env.SIGNUPS_PAUSED || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
