import type { FetchContext } from '../context';
import { isAuthUser, requireAuthUser } from '../helpers/auth-guard';
import {
  handleListPersonalFolders,
  handleCreatePersonalFolder,
  handleUpdatePersonalFolder,
  handleDeletePersonalFolder,
  handleMovePersonalArtifactToFolder,
} from '../../personal-folders';

export async function routeFolderApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  if (path === '/v1/folders') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') {
      return addCORS(await handleListPersonalFolders(request, env, user));
    }
    if (request.method === 'POST') {
      return addCORS(await handleCreatePersonalFolder(request, env, user));
    }
    return null;
  }

  const folderMatch = path.match(/^\/v1\/folders\/([^/]+)$/);
  if (folderMatch) {
    const [, folderId] = folderMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'PATCH' || request.method === 'PUT') {
      return addCORS(await handleUpdatePersonalFolder(request, env, user, folderId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDeletePersonalFolder(request, env, user, folderId));
    }
    return null;
  }

  const moveMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/folder$/);
  if (moveMatch && request.method === 'POST') {
    const [, artifactId] = moveMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleMovePersonalArtifactToFolder(request, env, user, artifactId));
  }

  return null;
}
