import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import {
  handleListFolders,
  handleCreateFolder,
  handleGetFolder,
  handleGetFolderByPath,
  handleUpdateFolder,
  handleDeleteFolder,
  handleMoveArtifactToFolder,
} from '../../folders';

/** Team Space folder routes + folder-scoped artifact move, split out of
 *  workspaces.ts to keep that file under the size cap. Returns null when no
 *  folder route matches so the caller falls through to the rest of the router. */
export async function routeWorkspaceFolders(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  const foldersMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/folders$/);
  if (foldersMatch) {
    const [, workspaceId] = foldersMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleListFolders(request, env, user, workspaceId));
    if (request.method === 'POST') return addCORS(await handleCreateFolder(request, env, user, workspaceId));
  }

  const folderByPathMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/folders\/by-path\/(.+)$/);
  if (folderByPathMatch && request.method === 'GET') {
    const [, workspaceId, folderPath] = folderByPathMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetFolderByPath(request, env, user, workspaceId, decodeURIComponent(folderPath)));
  }

  const folderMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/folders\/([^/]+)$/);
  if (folderMatch) {
    const [, workspaceId, folderId] = folderMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleGetFolder(request, env, user, workspaceId, folderId));
    if (request.method === 'PUT' || request.method === 'PATCH') return addCORS(await handleUpdateFolder(request, env, user, workspaceId, folderId));
    if (request.method === 'DELETE') return addCORS(await handleDeleteFolder(request, env, user, workspaceId, folderId));
  }

  const moveArtifactMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/artifacts\/([^/]+)\/move$/);
  if (moveArtifactMatch && request.method === 'POST') {
    const [, workspaceId, artifactId] = moveArtifactMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleMoveArtifactToFolder(request, env, user, workspaceId, artifactId));
  }

  return null;
}
