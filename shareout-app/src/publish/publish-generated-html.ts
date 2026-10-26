/**
 * Session-authenticated single-page HTML publish (/create build flow).
 * Skips token/rate-limit gating — callers authenticate the session and enforce the
 * daily publish limit + storage quota themselves (same as POST /v1/publish).
 */
import type { Env, PublishResponse, FileEntry, Visibility } from '../types';
import { resolveNameSlug } from './artifact-upsert';
import { coerceVisibility } from '../visibility-config';
import { publishArtifact } from './publish-artifact';

export async function publishGeneratedHtml(
  env: Env,
  user: { id: string; email: string },
  opts: { name: string; slug?: string; html: string; workspaceId?: string | null; visibility: Visibility },
): Promise<PublishResponse> {
  const slug = opts.slug || (await resolveNameSlug(env, opts.name, opts.workspaceId ?? null, user.id));
  const visibility = opts.visibility;
  const files: FileEntry[] = [{ path: 'index.html', content: opts.html, mime: 'text/html' }];

  const result = await publishArtifact(env, { id: user.id, email: user.email, username: null }, {
    name: opts.name,
    slug,
    entrypoint: 'index.html',
    files,
    visibility,
    authMethod: 'google',
    shareWith: [],
    credentials: [],
    workspaceId: opts.workspaceId ?? null,
    folderId: null,
    artifactType: 'html',
  });
  // Report what actually went live: a moderation hold (or public links being off on
  // this instance) keeps the page private even though the builder asked for public.
  result.visibility = result.moderation ? 'private' : coerceVisibility(env, visibility);
  return result;
}
