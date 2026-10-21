// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';

const h = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../src/data/platform', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/platform')>()),
  PlatformEngine: class { execute = h.execute; },
}));

import { queryConnectionAny } from '../../../src/data/connections/warehouse-query';
import { connectionQueryTool } from '../../../src/crew/tools/connection-query';

const WS = 'wsp_f22';
const ART = 'art_f22';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email) VALUES ('usr_f22', 'f22@example.test')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f22-w', 'usr_f22')").bind(WS),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'A', 'f22-a', 'usr_f22', ?, 'private')").bind(ART, WS),
    e.DB.prepare("INSERT INTO connections (id, scope_type, scope_id, name, provider, kind) VALUES ('conn_f22', 'workspace', ?, 'wh', 'bigquery', 'platform')").bind(WS),
  ]);
});

beforeEach(() => {
  h.execute.mockReset();
  h.execute.mockResolvedValue({ success: true, data: { schema: { fields: [] }, rows: [] } });
});

const ctx = { data: { env: e, artifactId: ART }, principal: { ownerId: 'usr_f22' } } as never;
const crew = (query: string) => connectionQueryTool.execute(ctx, { connection: 'wh', query, params: { projectId: 'p' } }) as Promise<{ error?: string }>;

describe('f22 crew warehouse SQL is read-only', () => {
  it('blocks: DML, DDL and chained statements from the crew tool never reach the warehouse', async () => {
    for (const sql of [
      'DROP TABLE x',
      'DELETE FROM t WHERE 1=1',
      'UPDATE t SET a = 1',
      'INSERT INTO t VALUES (1)',
      'CREATE TABLE t2 AS SELECT 1',
      'SELECT 1; DROP TABLE x',
      '/* select */ DROP TABLE x',
      '-- select\nDELETE FROM t',
      'WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d',
    ]) {
      expect((await crew(sql)).error, sql).toBeTruthy();
    }
    expect((await (connectionQueryTool.execute(ctx, { connection: 'wh', query: { sql: 'DROP TABLE x' } as never }) as Promise<{ error?: string }>)).error).toBeTruthy();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('still runs crew SELECT and WITH queries', async () => {
    for (const sql of ['SELECT 1', 'WITH c AS (SELECT 1 AS n) SELECT * FROM c']) {
      expect((await crew(sql)).error, sql).toBeUndefined();
    }
    expect(h.execute).toHaveBeenCalledTimes(2);
  });

  it('leaves owner-configured job SQL (delivery path) unrestricted', async () => {
    await queryConnectionAny(e, ART, 'wh', 'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = 1', { projectId: 'p' }, 'usr_f22');
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
});
