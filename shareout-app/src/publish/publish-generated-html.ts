/**
 * Session-authenticated single-page HTML publish (/create build flow).
 * Skips token/rate-limit gating — callers authenticate the session and enforce the
 * daily publish limit + storage quota themselves (same as POST /v1/publish).
 */
import type { Env, PublishResponse, FileEntry, Visibility } from '../types';
import { resolveNameSlug } from './artifact-upsert';
import { publishArtifact } from './publish-artifact';

export async function publishGeneratedHtml(
  env: Env,
  user: { id: string; email: string },
  opts: { name: string; slug?: string; html: string; workspaceId?: string | null; visibility: Visibility; allowOpen?: boolean },
): Promise<PublishResponse> {
  const { html, ...rest } = opts;
  return publishGeneratedFiles(env, user, { ...rest, files: [{ path: 'index.html', content: html, mime: 'text/html' }] });
}

/** Same, for a page of several files (the build agent's output). `index.html` is the entry. Publishing an existing slug again adds a version. */
export async function publishGeneratedFiles(
  env: Env,
  user: { id: string; email: string },
  opts: { name: string; slug?: string; files: FileEntry[]; workspaceId?: string | null; visibility: Visibility; allowOpen?: boolean },
): Promise<PublishResponse> {
  const slug = opts.slug || (await resolveNameSlug(env, opts.name, opts.workspaceId ?? null, user.id));
  const visibility = opts.visibility;
  const files = opts.files;

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
    allowOpen: opts.allowOpen,
  });
  return result;
}
