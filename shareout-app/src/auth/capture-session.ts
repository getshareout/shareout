import type { Env } from '../types';
import { createAccessToken, type AccessTokenPayload } from '../token';

// Credentials of a headless capture render (thumbnail, image/PDF, report, Artifact
// Tests). The renderer opens the bare artifact page with a capture link token
// (`?_capture=`); serving that page injects a session token so the page's SDK can read
// its data. Both are visible to the page's own scripts, so both stay as narrow as a
// render allows:
//   - one window: the link lives CAPTURE_TTL_SEC and every session it opens ends no
//     later than the link, so reloading the link never extends access;
//   - artifact-scoped, read-only: the session is `owner_test` (the data router refuses
//     every write) bound to one artifact id;
//   - no identity: the session carries no email, so it never resolves to the owner's
//     account (workspace Knowledge, shared tables, connections, per-user credentials).
// Tokens are stateless HMAC, so a session cannot be revoked when the render ends; the
// short window is the bound.

/** One capture render's window, from the moment its link is minted. */
export const CAPTURE_TTL_SEC = 10 * 60;

/** The pilot_verify session can write: it must not outlive its ≤90 s run. */
export const WRITABLE_CAPTURE_SESSION_TTL_SEC = 120;

// Clock slack when checking a session's remaining lifetime.
const SKEW_SEC = 60;

/** The `?_capture=` token for a read-only render of `artifactId`. */
export function mintCaptureLinkToken(env: Env, artifactId: string): Promise<string> {
  return createAccessToken(artifactId, 'capture', env, CAPTURE_TTL_SEC);
}

/**
 * The page session for a capture view opened with a link that expires at `linkExp`
 * (epoch seconds). Read-only renders get an identity-less `owner_test` session;
 * `writable` (pilot_verify) gets the owner's own short write session.
 */
export function mintCaptureSessionToken(
  env: Env,
  artifactId: string,
  opts: { linkExp: number; writable?: boolean; ownerEmail?: string | null },
): Promise<string> {
  const ttl = opts.writable ? WRITABLE_CAPTURE_SESSION_TTL_SEC : CAPTURE_TTL_SEC;
  // createAccessToken reads the clock again; the 1 s keeps exp at or before the link's
  // (a link that has already lapsed yields a session that has too).
  const maxAge = Math.min(ttl, opts.linkExp - Math.floor(Date.now() / 1000) - 1);
  return opts.writable
    ? createAccessToken(artifactId, 'owner', env, maxAge, opts.ownerEmail ?? undefined)
    : createAccessToken(artifactId, 'owner_test', env, maxAge);
}

/** Whether an `owner_test` payload has the shape capture renders mint: no identity, and
 *  no more than one capture window left. Anything else is refused by the data layer. */
export function isCaptureSession(payload: AccessTokenPayload, nowSec = Date.now() / 1000): boolean {
  return payload.authType === 'owner_test'
    && !payload.email
    && payload.exp - nowSec <= CAPTURE_TTL_SEC + SKEW_SEC;
}

// 'capture_test' is the earlier name of 'capture'; 'capture_verify' opens pilot_verify.
const CAPTURE_LINK_TYPES = new Set(['capture', 'capture_test', 'capture_verify']);

/** A capture link token: it opens the capture view and is no data credential. */
export function isCaptureLink(authType: string): boolean {
  return CAPTURE_LINK_TYPES.has(authType);
}

/** Capture links and read-only capture sessions. Each is only good as itself (the
 *  capture view, a Bearer data read) — never as a password-gate cookie. */
export function isCaptureCredential(authType: string): boolean {
  return isCaptureLink(authType) || authType === 'owner_test';
}
