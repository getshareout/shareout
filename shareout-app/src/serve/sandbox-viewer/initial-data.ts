import type { Env } from '../../types';
import { createAccessToken } from '../../token';
import type { AdminInfo, InitialJsonData, InitialTableData } from '../types';
import type { ViewerUser } from './types';
import { serializeForInlineScript } from './serialize';
import { mintSpaceGuestAccessToken, type SpaceGuest } from '../../sharees/space-guest';

export interface InitialViewerData {
  payload: Record<string, unknown>;
  serialized: string;
  scriptTag: string;
  currentUser: ViewerUser | null;
}

/**
 * Build the JSON blob posted into the sandboxed iframe via postMessage.
 * Includes prefetched json/tables, admin hints, and a short-lived session token.
 */
export async function buildInitialViewerData(
  sessionUser: { id: string; email: string } | null,
  env: Env,
  artifactId: string,
  baseUrl: string,
  initialJsonData: InitialJsonData | null,
  initialTableData: InitialTableData | null,
  adminInfo: AdminInfo | null,
  // Prefetched alongside the rest of the per-view batch so it no longer adds a
  // sequential D1 round-trip here.
  profile: { name: string | null; picture: string | null } | null,
  // A space guest (no account): gets a grant-bound token instead of a viewer token, so
  // every data call the page makes re-checks the grant.
  spaceGuest: SpaceGuest | null = null,
  // Caps the role embedded in the token (owner -> editor when an editor authored the live version).
  tokenRole?: AdminInfo['role'],
): Promise<InitialViewerData> {
  const initialData: Record<string, unknown> = {
    artifactId,
    baseUrl,
  };

  if (initialJsonData?.data) {
    initialData.json = initialJsonData.data;
  }
  if (initialTableData?.tables) {
    initialData.tables = initialTableData.tables;
  }
  if (adminInfo) {
    initialData.admin = adminInfo;
  }

  // The artifact runs in a sandboxed (opaque-origin) iframe and cannot send
  // the session cookie. Mint a short-lived, artifact-scoped token carrying the
  // authenticated viewer's identity so the SDK can authenticate data + agent
  // calls as a Bearer token. Access was already enforced upstream (checkAccess).
  let currentUser: ViewerUser | null = null;

  if (sessionUser) {
    const authType = tokenRole ?? adminInfo?.role ?? 'viewer';
    initialData.sessionToken = await createAccessToken(
      artifactId,
      authType,
      env,
      60 * 60 * 2,
      sessionUser.email,
    );
    currentUser = {
      email: sessionUser.email,
      name: profile?.name || '',
      picture: profile?.picture || '',
    };
    // Surface the viewer's own identity to the artifact (sdk.me()). Access was
    // already enforced upstream; this only ever exposes the viewer to themselves.
    initialData.viewer = {
      email: currentUser.email,
      name: currentUser.name,
      picture: currentUser.picture,
    };
  } else if (spaceGuest) {
    initialData.sessionToken = await mintSpaceGuestAccessToken(env, artifactId, spaceGuest);
  }

  const serialized = serializeForInlineScript(initialData);
  const scriptTag = `<script id="shareout-initial-data" type="application/json">${serialized}</script>\n  `;

  return { payload: initialData, serialized, scriptTag, currentUser };
}
