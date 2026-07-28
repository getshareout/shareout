/**
 * Authentication domain — sessions, Google OAuth, artifact access, and auth pages.
 *
 * Module layout:
 * - `session` — zone-wide session cookies, `getSessionUser`, max-age policy
 * - `cookies` — cookie attribute helpers (domain, secure, build)
 * - `users` — find-or-create users (email, Google), account linking
 * - `google-oauth` — redirect-based Google sign-in and callback
 * - `google-one-tap` — Sign in with Google (ID-token flow)
 * - `google-id-token` — JWT verification against Google JWKS
 * - `dev-login` — localhost-only session helper (`/auth/dev`)
 * - `logout` — clear session cookie
 * - `pages` — HTML login, access-denied, password/credentials forms
 * - `artifact-auth` — per-artifact password/credentials and access tokens
 */
export { COOKIE_NAME, SESSION_MAX_AGE } from './constants';
export { buildSessionCookie } from './cookies';
export {
  resolveSessionMaxAge,
  getSessionUser,
  createSessionCookieForUser,
} from './session';
export { upsertUserByEmail } from './users';
export {
  handleGoogleLogin,
  handleLinkGoogleStart,
  handleGoogleCallback,
} from './google-oauth';
export { handleGoogleOneTap } from './google-one-tap';
export { handleDevLogin } from './dev-login';
export { handleLogout } from './logout';
export {
  loginPage,
  appLoginPage,
  accessDeniedPage,
  passwordLoginPage,
  credentialsLoginPage,
} from './pages';
export {
  handlePasswordAuth,
  handleCredentialsAuth,
  verifyAccessToken,
} from './artifact-auth';
