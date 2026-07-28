/** Session cookie name — zone-wide across apex and workspace subdomains. */
export const COOKIE_NAME = 'shareout_session';

/** Default session lifetime (30 days) when no workspace policy applies. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
