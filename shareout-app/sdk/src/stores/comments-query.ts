import type { SdkClient } from '../core/sdk-client';
import type { Comment } from './comment-types';

export class CommentsQuery {
  private _filter: { contextId?: string; parentId?: string | null } = {};
  private _sort: { field: string; order: 'asc' | 'desc' } = { field: 'createdAt', order: 'desc' };
  private _limit = 100;
  private _skip = 0;

  constructor(
    private sdk: SdkClient,
    filter?: { contextId?: string; parentId?: string | null }
  ) {
    if (filter) this._filter = filter;
  }

  context(contextId: string): CommentsQuery {
    this._filter.contextId = contextId;
    return this;
  }

  topLevel(): CommentsQuery {
    this._filter.parentId = null;
    return this;
  }

  sort(field: 'createdAt' | 'updatedAt', order: 'asc' | 'desc'): CommentsQuery {
    this._sort = { field, order };
    return this;
  }

  limit(n: number): CommentsQuery {
    this._limit = n;
    return this;
  }

  skip(n: number): CommentsQuery {
    this._skip = n;
    return this;
  }

  async exec(): Promise<Comment[]> {
    const params = new URLSearchParams();
    if (this._filter.contextId) params.set('contextId', this._filter.contextId);
    if (this._filter.parentId === null) params.set('parentId', 'null');
    else if (this._filter.parentId) params.set('parentId', this._filter.parentId);
    params.set('limit', String(this._limit));
    params.set('skip', String(this._skip));

    const query = params.toString();
    const result = await this.sdk._internalFetch<{ comments: Comment[]; count: number }>(
      `/comments${query ? '?' + query : ''}`
    );
    return result.comments;
  }
}
