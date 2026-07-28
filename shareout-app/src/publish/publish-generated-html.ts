/**
 * Session-authenticated single-page HTML publish (/create build flow).
 * Skips token/rate-limit gating — caller already authenticated by cookie.
 */
import type { Env, PublishResponse, FileEntry } from '../types';
import { generateSlug } from '../validation';
import { publishArtifact } from './publish-artifact';

export async function publishGeneratedHtml(
  env: Env,
  user: { id: string; email: string },
  opts: { name: string; slug?: string; html: string },
): Promise<PublishResponse> {
  const slug = opts.slug || generateSlug(opts.name);
  const files: FileEntry[] = [{ path: 'index.html', content: opts.html, mime: 'text/html' }];

  return publishArtifact(env, { id: user.id, email: user.email, username: null }, {
    name: opts.name,
    slug,
    entrypoint: 'index.html',
    files,
    visibility: 'public',
    authMethod: 'google',
    shareWith: [],
    credentials: [],
    workspaceId: null,
    folderId: null,
    artifactType: 'html',
  });
}
