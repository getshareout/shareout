// @vitest-environment node
/**
 * Request helpers and context builders for comments handler unit tests.
 * @module tests/unit/data/comments/shared
 */
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';
import {
  ARTIFACT_ID,
  createCommentsDb,
  type CommentsDbBundle,
  type StoredComment,
  type StoredCollaborator,
  type StoredUser,
} from '../comments-mock-db';

export {
  ARTIFACT_ID,
  createCommentsDb,
  type CommentsDbBundle,
  type StoredComment,
  type StoredCollaborator,
  type StoredUser,
};

export const ROOT_COMMENT = 'cmt_000000000000000000000001';
export const CHILD_COMMENT = 'cmt_000000000000000000000002';
export const GRANDCHILD = 'cmt_000000000000000000000003';

export function ctxFromDb(
  dbBundle: CommentsDbBundle,
  overrides?: Partial<DataContext['artifact']>,
): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    workspaceId: '',
    db: dbBundle.db as unknown as DataContext['db'],
    artifact: {
      id: ARTIFACT_ID,
      name: 'Test Artifact',
      visibility: 'public',
      auth_method: null,
      owner_id: 'usr_owner',
      ...overrides,
    },
    env: {
      SESSION_SECRET: 'session-secret',
      DB: dbBundle.db,
      COMMENTS: dbBundle.commentsDo,
    } as unknown as Env,
    origin: 'https://app.example.com',
  } as DataContext;
}

export function commentsRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://example.com/v1/data/${ARTIFACT_ID}/comments${path}`, init);
}
