// The two artifact-scoped tokens a one-time code buys. Neither names a person or carries a
// session, so neither may ever authorize the data API or any surface but the page itself.

/** The code holder's pass cookie: `otv:<code id>`, alive for the code's window. */
export const VIEW_PASS_PREFIX = 'otv:';

/** The content-domain token minted for a code holder's frame. */
export const VIEW_CONTENT_AUTH = 'content_otv';

export function isViewCodeToken(authType: string): boolean {
  return authType === VIEW_CONTENT_AUTH || authType.startsWith(VIEW_PASS_PREFIX);
}
