import { ShareOutError } from '../shareout-error';
import type { SdkClient } from '../core/sdk-client';

type FilterOperator<T> = {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  $in?: T[];
  $nin?: T[];
  $contains?: string;
  $startsWith?: string;
  $endsWith?: string;
};

type Filter<T> = {
  [K in keyof T]?: T[K] | FilterOperator<T[K]>;
};

class Query<T extends { id: string }> {
  private _filter: Filter<T> = {};
  private _sort: Record<string, 'asc' | 'desc'> = {};
  private _limit = 100;
  private _skip = 0;
  private _select?: (keyof T)[];

  constructor(
    private sdk: SdkClient,
    private tableName: string,
    private prefix: string,
    filter?: Filter<T>
  ) {
    if (filter) this._filter = filter;
  }

  filter(filter: Filter<T>): Query<T> {
    this._filter = { ...this._filter, ...filter };
    return this;
  }

  sort(field: keyof T, order: 'asc' | 'desc'): Query<T> {
    this._sort[field as string] = order;
    return this;
  }

  limit(n: number): Query<T> {
    this._limit = n;
    return this;
  }

  skip(n: number): Query<T> {
    this._skip = n;
    return this;
  }

  select(fields: (keyof T)[]): Query<T> {
    this._select = fields;
    return this;
  }

  async exec(): Promise<T[]> {
    const result = await this.sdk._internalFetch<{ rows: T[]; hasMore: boolean }>(
      `${this.prefix}/${encodeURIComponent(this.tableName)}/query`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: this._filter,
          sort: this._sort,
          limit: this._limit,
          skip: this._skip,
          select: this._select,
          // exec() returns only rows, so skip the server-side COUNT(*) scan.
          count: false,
        }),
      }
    );
    return result.rows;
  }
}

export class Table<T extends { id: string } = { id: string }> {
  // prefix is the data-tier path root: '/tables' for own data, '/workspace/tables'
  // for a workspace-shared table (resolved server-side to the owner artifact).
  constructor(private sdk: SdkClient, private name: string, private prefix: string = '/tables') {}

  async insert(doc: Omit<T, 'id'>): Promise<T> {
    const result = await this.sdk._internalFetch<{ inserted: T[]; count: number }>(
      `${this.prefix}/${encodeURIComponent(this.name)}`,
      {
        method: 'POST',
        body: JSON.stringify(doc),
      }
    );
    return result.inserted[0];
  }

  async insertMany(docs: Omit<T, 'id'>[]): Promise<T[]> {
    const result = await this.sdk._internalFetch<{ inserted: T[]; count: number }>(
      `${this.prefix}/${encodeURIComponent(this.name)}`,
      {
        method: 'POST',
        body: JSON.stringify({ rows: docs }),
      }
    );
    return result.inserted;
  }

  find(filter?: Filter<T>): Query<T> {
    return new Query<T>(this.sdk, this.name, this.prefix, filter);
  }

  async findOne(filter: Filter<T>): Promise<T | null> {
    const results = await this.find(filter).limit(1).exec();
    return results[0] || null;
  }

  async findById(id: string): Promise<T | null> {
    try {
      return await this.sdk._internalFetch<T>(
        `${this.prefix}/${encodeURIComponent(this.name)}/${encodeURIComponent(id)}`
      );
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'ROW_NOT_FOUND') {
        return null;
      }
      throw e;
    }
  }

  async update(filter: Filter<T>, changes: Partial<T>): Promise<{ updated: number }> {
    return this.sdk._internalFetch<{ updated: number }>(
      `${this.prefix}/${encodeURIComponent(this.name)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ filter, changes }),
      }
    );
  }

  async updateById(id: string, changes: Partial<T>): Promise<T | null> {
    try {
      return await this.sdk._internalFetch<T>(
        `${this.prefix}/${encodeURIComponent(this.name)}/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(changes),
        }
      );
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'ROW_NOT_FOUND') {
        return null;
      }
      throw e;
    }
  }

  async delete(filter: Filter<T>): Promise<{ deleted: number }> {
    return this.sdk._internalFetch<{ deleted: number }>(
      `${this.prefix}/${encodeURIComponent(this.name)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ filter }),
      }
    );
  }

  async deleteById(id: string): Promise<boolean> {
    try {
      await this.sdk._internalFetch(
        `${this.prefix}/${encodeURIComponent(this.name)}/${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      return true;
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'ROW_NOT_FOUND') {
        return false;
      }
      throw e;
    }
  }

  async count(filter?: Filter<T>): Promise<number> {
    const result = await this.sdk._internalFetch<{ count: number }>(
      `${this.prefix}/${encodeURIComponent(this.name)}/count`,
      {
        method: 'POST',
        body: JSON.stringify({ filter }),
      }
    );
    return result.count;
  }

  async distinct<K extends keyof T>(field: K, filter?: Filter<T>): Promise<T[K][]> {
    const result = await this.sdk._internalFetch<{ values: T[K][] }>(
      `${this.prefix}/${encodeURIComponent(this.name)}/distinct`,
      {
        method: 'POST',
        body: JSON.stringify({ field, filter }),
      }
    );
    return result.values;
  }
}
