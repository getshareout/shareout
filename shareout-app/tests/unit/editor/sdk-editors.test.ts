// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { handleSDKEditor, type SDKEditorContext } from '../../../src/editor/sdk-editors/index';
import { createMockFile, createMockFormData } from './helpers/happy-dom-mocks';
import type { DetectedComponent } from '../../../src/editor/types';
import type { Env } from '../../../src/types';
import { miniDbBinding } from '../helpers/minidb-mock';

const ARTIFACT_ID = 'art_sdk_test';
const USER_ID = 'user_test';

type DbScenario = {
  jsonKeys?: Array<{ key: string; value: string; typeof_value: string; updated_at: string }>;
  jsonValue?: { value: string } | null;
  tableSchema?: Array<{
    column_name: string;
    column_type: string;
    is_indexed: number;
    is_required: number;
  }>;
  tableRows?: Array<{ id: string; data: string; created_at: string; updated_at?: string }>;
  tableRowCount?: number;
  blobs?: Array<{
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    r2_key: string;
    created_at: string;
  }>;
  blobR2Key?: { r2_key: string } | null;
  commentsConfig?: {
    enabled: number;
    identity_mode: string;
    allow_replies: number;
    max_depth: number;
    require_approval: number;
  } | null;
  commentStats?: { total: number; resolved: number };
  collaboratorRole?: string | null;
  realtimeConfig?: {
    doc_id: string;
    show_presence: number;
    show_cursors: number;
    max_connections: number;
  } | null;
  sheetsConfig?: {
    spreadsheet_id: string;
    range: string;
    sync_mode: string;
    refresh_interval: number;
    last_sync: string;
  } | null;
  githubConfig?: {
    repo: string;
    branch: string;
    auto_sync: number;
    last_commit: string;
    last_sync: string;
  } | null;
  collaborators?: Array<{
    email: string;
    role: string;
    invited_at: string;
    accepted_at: string | null;
    name: string | null;
    picture: string | null;
  }>;
  agentConfig?: {
    visitor_enabled: number;
    visitor_system_prompt: string | null;
    visitor_model: string;
    visitor_max_tokens: number;
    visitor_temperature: number;
    visitor_context_json: number;
    visitor_context_tables: string | null;
    visitor_context_blobs: number;
    admin_enabled: number;
    admin_model: string;
  } | null;
  slides?: Array<{
    id: string;
    position: number;
    content_html: string;
    background: string | null;
    transition_type: string | null;
    transition_duration: number | null;
    hidden: number;
    speaker_notes: string | null;
  }>;
  presentationConfig?: {
    title: string;
    aspect_ratio: string;
    default_transition: string;
    auto_play_interval: number;
  } | null;
  maxSlidePosition?: { max_pos: number | null };
};

function resolveFirst(sql: string, _args: unknown[], scenario: DbScenario): unknown {
  if (sql.includes('artifact_json') && sql.includes('COUNT')) return null;
  if (sql.includes('artifact_tables')) {
    const out: Record<string, unknown> = {};
    if (sql.includes('id')) out.id = 'tbl_mock';
    if (sql.includes('row_count')) out.row_count = scenario.tableRowCount ?? 0;
    return Object.keys(out).length ? out : null;
  }
  if (sql.includes('FROM artifact_comments') && sql.includes('COUNT')) {
    return { total: scenario.commentStats?.total ?? 0, resolved: scenario.commentStats?.resolved ?? 0 };
  }
  if (sql.includes('SELECT role FROM collaborators')) {
    return scenario.collaboratorRole != null ? { role: scenario.collaboratorRole } : null;
  }
  if (sql.includes('artifact_json') && sql.includes('SELECT value')) {
    return scenario.jsonValue ?? null;
  }
  if (sql.includes('artifact_table_rows') && sql.includes('COUNT')) {
    return { count: scenario.tableRowCount ?? 0 };
  }
  if (sql.includes('FROM blobs') && sql.includes('r2_key')) {
    return scenario.blobR2Key ?? null;
  }
  if (sql.includes('artifact_comments_config')) return scenario.commentsConfig ?? null;
  if (sql.includes('FROM comments') && sql.includes('COUNT')) {
    return scenario.commentStats ?? { total: 0, approved: 0, pending: 0 };
  }
  if (sql.includes('artifact_realtime_config')) return scenario.realtimeConfig ?? null;
  if (sql.includes('artifact_sheets_config')) return scenario.sheetsConfig ?? null;
  if (sql.includes('artifact_github_config')) return scenario.githubConfig ?? null;
  if (sql.includes('artifact_agent_config')) return scenario.agentConfig ?? null;
  if (sql.includes('artifact_presentation_config')) return scenario.presentationConfig ?? null;
  if (sql.includes('MAX(position)')) return scenario.maxSlidePosition ?? { max_pos: 0 };
  return null;
}

function resolveAll(sql: string, _args: unknown[], scenario: DbScenario): unknown[] {
  if (sql.includes('artifact_json') && sql.includes('SELECT key')) return scenario.jsonKeys ?? [];
  if (sql.includes('FROM artifact_rows')) return scenario.tableRows ?? [];
  if (sql.includes('FROM blobs')) return scenario.blobs ?? [];
  if (sql.includes('artifact_table_schemas')) return scenario.tableSchema ?? [];
  if (sql.includes('artifact_table_rows')) return scenario.tableRows ?? [];
  if (sql.includes('artifact_blobs')) return scenario.blobs ?? [];
  if (sql.includes('collaborators')) return scenario.collaborators ?? [];
  if (sql.includes('artifact_slides')) return scenario.slides ?? [];
  return [];
}

function makeEnv(scenario: DbScenario = {}): Env {
  const r2Put = vi.fn(async () => undefined);
  const r2Delete = vi.fn(async () => undefined);

  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        all: vi.fn(async () => ({ results: resolveAll(sql, bindArgs, scenario) })),
        first: vi.fn(async () => resolveFirst(sql, bindArgs, scenario)),
        run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
      })),
    })),
    batch: vi.fn(async (stmts: unknown[]) =>
      Array.isArray(stmts) ? stmts.map(() => ({ success: true, meta: { changes: 1 } })) : [],
    ),
  };

  return {
    DB: db as unknown as Env['DB'],
    // Per-artifact mini-store (ADR 28): route the DO exec protocol back through the
    // same SQL-dispatch mock so json/table/binding editors read the live store.
    MINIDB: miniDbBinding(db as unknown as Parameters<typeof miniDbBinding>[0]) as unknown as Env['MINIDB'],
    ARTIFACTS: { put: r2Put, get: vi.fn(), delete: r2Delete } as unknown as Env['ARTIFACTS'],
    SESSION_SECRET: 'test-secret',
  } as Env;
}

function baseComponent(overrides: Partial<DetectedComponent> = {}): DetectedComponent {
  return {
    type: 'json',
    selector: '[data-shareout-json]',
    name: 'default',
    config: {},
    ...overrides,
  };
}

function makeCtx(
  env: Env,
  component: DetectedComponent = baseComponent(),
  role: 'owner' | 'editor' | 'viewer' = 'owner',
): SDKEditorContext {
  return { artifactId: ARTIFACT_ID, userId: USER_ID, role, env, component };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

function jsonReq(path: string, body?: unknown, method = 'POST'): Request {
  return new Request(`https://editor.test/sdk/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('handleSDKEditor', () => {
  describe('router', () => {
    it('returns 400 for unknown SDK type', async () => {
      const res = await handleSDKEditor(
        new Request('https://x'),
        makeCtx(makeEnv()),
        'unknown/get',
      );
      expect(res.status).toBe(400);
      const body = await readJson(res);
      expect(body.code).toBe('INVALID_SDK_TYPE');
    });

    it('defaults action to get when omitted', async () => {
      const env = makeEnv({
        jsonKeys: [{ key: 'a', value: '"1"', typeof_value: 'number', updated_at: 't' }],
      });
      const res = await handleSDKEditor(new Request('https://x'), makeCtx(env), 'json');
      expect(res.status).toBe(200);
      const body = await readJson(res);
      expect(body.success).toBe(true);
      expect((body.keys as unknown[]).length).toBe(1);
    });
  });

  describe('json editor', () => {
    it('get lists keys with parsed values', async () => {
      const env = makeEnv({
        jsonKeys: [
          { key: 'title', value: '"Hello"', typeof_value: 'string', updated_at: '2024-01-01' },
          { key: 'broken', value: 'not-json{', typeof_value: 'string', updated_at: '2024-01-02' },
        ],
      });
      const res = await handleSDKEditor(new Request('https://x'), makeCtx(env), 'json/get');
      const body = await readJson(res);
      expect(body.keys).toEqual([
        expect.objectContaining({ key: 'title', value: 'Hello' }),
        expect.objectContaining({ key: 'broken', value: 'not-json{' }),
      ]);
    });

    it('set requires key', async () => {
      const res = await handleSDKEditor(
        jsonReq('json/set', { value: 1 }),
        makeCtx(makeEnv()),
        'json/set',
      );
      expect(res.status).toBe(400);
    });

    it('set and delete succeed', async () => {
      const env = makeEnv();
      const setRes = await handleSDKEditor(
        jsonReq('json/set', { key: 'k', value: { nested: true } }),
        makeCtx(env),
        'json/set',
      );
      expect((await readJson(setRes)).success).toBe(true);

      const delRes = await handleSDKEditor(
        jsonReq('json/delete', { key: 'k' }),
        makeCtx(env),
        'json/delete',
      );
      expect((await readJson(delRes)).success).toBe(true);
    });

    it('delete requires key', async () => {
      const res = await handleSDKEditor(
        jsonReq('json/delete', {}),
        makeCtx(makeEnv()),
        'json/delete',
      );
      expect(res.status).toBe(400);
    });

    it('rejects unknown action', async () => {
      const res = await handleSDKEditor(new Request('https://x'), makeCtx(makeEnv()), 'json/patch');
      expect(res.status).toBe(400);
      expect((await readJson(res)).code).toBe('INVALID_ACTION');
    });
  });

  describe('table editor', () => {
    const tableComponent = () =>
      baseComponent({ type: 'table', name: 'orders' });

    it('get returns schema, sample rows, and count', async () => {
      const env = makeEnv({
        tableRows: [{ id: 'r1', data: '{"qty":2}', created_at: 't' }],
        tableRowCount: 42,
      });
      const res = await handleSDKEditor(
        new Request('https://x'),
        makeCtx(env, tableComponent()),
        'table/get',
      );
      const body = await readJson(res);
      expect(body.tableName).toBe('orders');
      expect(body.totalRows).toBe(42);
      // schema is derived from sample-row keys (the store is schemaless)
      expect(body.schema).toEqual([{ name: 'qty', type: 'number' }]);
      expect(body.sampleRows).toEqual([expect.objectContaining({ id: 'r1', data: { qty: 2 } })]);
    });

    it('schema action is not supported (schema lives in the manifest)', async () => {
      const res = await handleSDKEditor(
        jsonReq('table/schema', {
          columns: [{ name: 'a', type: 'text', indexed: true, required: false }],
        }),
        makeCtx(makeEnv(), tableComponent()),
        'table/schema',
      );
      expect(res.status).toBe(400);
      expect((await readJson(res)).code).toBe('NOT_SUPPORTED');
    });

    it('rows supports limit and offset query params', async () => {
      const env = makeEnv({
        tableRows: [
          {
            id: 'r2',
            data: '{}',
            created_at: 'c',
            updated_at: 'u',
          },
        ],
      });
      const req = new Request('https://x/table/rows?limit=10&offset=5');
      const res = await handleSDKEditor(req, makeCtx(env, tableComponent()), 'table/rows');
      const body = await readJson(res);
      expect(body.rows).toHaveLength(1);
    });

    it('insert, update, and delete rows', async () => {
      const env = makeEnv();
      const insert = await handleSDKEditor(
        jsonReq('table/insert', { data: { x: 1 } }),
        makeCtx(env, tableComponent()),
        'table/insert',
      );
      const insertBody = await readJson(insert);
      expect(insertBody.id).toMatch(/^row_/);

      await handleSDKEditor(
        jsonReq('table/update', { id: 'r1', data: { x: 2 } }),
        makeCtx(env, tableComponent()),
        'table/update',
      );
      const del = await handleSDKEditor(
        jsonReq('table/delete', { id: 'r1' }),
        makeCtx(env, tableComponent()),
        'table/delete',
      );
      expect((await readJson(del)).success).toBe(true);
    });

    it('uses default table name when component name missing', async () => {
      const res = await handleSDKEditor(
        new Request('https://x'),
        makeCtx(makeEnv(), baseComponent({ type: 'table', name: undefined })),
        'table/get',
      );
      expect((await readJson(res)).tableName).toBe('default');
    });
  });

  describe('blobs editor', () => {
    it('get lists files with shareout URLs', async () => {
      const env = makeEnv({
        blobs: [
          {
            id: 'b1',
            filename: 'a.png',
            mime_type: 'image/png',
            size_bytes: 100,
            r2_key: 'k',
            created_at: 't',
          },
        ],
      });
      const res = await handleSDKEditor(new Request('https://x'), makeCtx(env), 'blobs/get');
      const body = await readJson(res);
      expect(body.files).toEqual([
        expect.objectContaining({
          id: 'b1',
          url: `/v1/data/${ARTIFACT_ID}/blobs/b1/content`,
        }),
      ]);
    });

    it('upload stores file via R2 and DB (happy-dom mock File)', async () => {
      const env = makeEnv();
      const form = createMockFormData(
        createMockFile(['pixels'], 'photo.png', { type: 'image/png' }),
      );

      const res = await handleSDKEditor(
        new Request('https://x/blobs/upload', { method: 'POST', body: form }),
        makeCtx(env),
        'blobs/upload',
      );
      const body = await readJson(res);
      expect(body.success).toBe(true);
      expect(body.url).toContain(ARTIFACT_ID);
      expect(env.ARTIFACTS.put).toHaveBeenCalled();
    });

    it('upload requires file', async () => {
      const res = await handleSDKEditor(
        new Request('https://x', { method: 'POST', body: new FormData() }),
        makeCtx(makeEnv()),
        'blobs/upload',
      );
      expect(res.status).toBe(400);
    });

    it('delete removes R2 object when metadata exists', async () => {
      const env = makeEnv({ blobR2Key: { r2_key: 'blobs/x/y' } });
      const res = await handleSDKEditor(
        jsonReq('blobs/delete', { id: 'b1' }),
        makeCtx(env),
        'blobs/delete',
      );
      expect((await readJson(res)).success).toBe(true);
      expect(env.ARTIFACTS.delete).toHaveBeenCalledWith('blobs/x/y');
    });
  });

  describe('comments editor', () => {
    it('get returns stored config and stats', async () => {
      const env = makeEnv({
        jsonValue: {
          value: JSON.stringify({
            enabled: true,
            overlayEnabled: true,
            identityMode: 'email',
            allowReplies: false,
            maxDepth: 5,
            requireApproval: true,
          }),
        },
        commentStats: { total: 10, resolved: 7 },
      });
      const body = await readJson(
        await handleSDKEditor(new Request('https://x'), makeCtx(env), 'comments/get'),
      );
      expect(body.config).toMatchObject({
        enabled: true,
        identityMode: 'email',
        allowReplies: false,
        maxDepth: 5,
        requireApproval: true,
      });
      expect(body.stats).toEqual({ total: 10, resolved: 7, open: 3 });
    });

    it('get uses defaults when no config row', async () => {
      const body = await readJson(
        await handleSDKEditor(new Request('https://x'), makeCtx(makeEnv()), 'comments/get'),
      );
      expect(body.config).toMatchObject({ enabled: true, identityMode: 'anonymous' });
    });

    it('update persists config', async () => {
      const res = await handleSDKEditor(
        jsonReq('comments/update', { enabled: true, allowReplies: true }),
        makeCtx(makeEnv()),
        'comments/update',
      );
      expect((await readJson(res)).success).toBe(true);
    });
  });

  describe('realtime editor', () => {
    it('get returns config or defaults for doc id', async () => {
      const withConfig = makeEnv({
        realtimeConfig: {
          doc_id: 'live',
          show_presence: 0,
          show_cursors: 1,
          max_connections: 10,
        },
      });
      const body = await readJson(
        await handleSDKEditor(
          new Request('https://x'),
          makeCtx(withConfig, baseComponent({ type: 'realtime', name: 'live' })),
          'realtime/get',
        ),
      );
      expect(body.config).toMatchObject({ docId: 'live', showPresence: false, maxConnections: 10 });

      const defaults = await readJson(
        await handleSDKEditor(
          new Request('https://x'),
          makeCtx(makeEnv(), baseComponent({ type: 'realtime', name: 'room' })),
          'realtime/get',
        ),
      );
      expect(defaults.config).toMatchObject({ docId: 'room', showPresence: true });
    });

    it('update writes realtime settings', async () => {
      const res = await handleSDKEditor(
        jsonReq('realtime/update', { showPresence: false, maxConnections: 25 }),
        makeCtx(makeEnv(), baseComponent({ type: 'realtime', name: 'doc1' })),
        'realtime/update',
      );
      expect((await readJson(res)).success).toBe(true);
    });
  });

  describe('sheets editor', () => {
    it('get returns null when unconfigured', async () => {
      const body = await readJson(
        await handleSDKEditor(new Request('https://x'), makeCtx(makeEnv()), 'sheets/get'),
      );
      expect(body.config).toBeNull();
    });

    it('get and update with spreadsheet config', async () => {
      const env = makeEnv({
        sheetsConfig: {
          spreadsheet_id: 'sheet123',
          range: 'A1:B2',
          sync_mode: 'auto',
          refresh_interval: 60,
          last_sync: '2024-01-01',
        },
      });
      const getBody = await readJson(
        await handleSDKEditor(new Request('https://x'), makeCtx(env), 'sheets/get'),
      );
      expect(getBody.config).toMatchObject({ spreadsheetId: 'sheet123', syncMode: 'auto' });

      const upd = await handleSDKEditor(
        jsonReq('sheets/update', { spreadsheetId: 'new', range: 'C:D' }),
        makeCtx(env),
        'sheets/update',
      );
      expect((await readJson(upd)).success).toBe(true);
    });
  });

  describe('github editor', () => {
    it('get returns repo config when present', async () => {
      const env = makeEnv({
        githubConfig: {
          repo: 'org/repo',
          branch: 'dev',
          auto_sync: 1,
          last_commit: 'abc',
          last_sync: 'now',
        },
      });
      const body = await readJson(
        await handleSDKEditor(new Request('https://x'), makeCtx(env), 'github/get'),
      );
      expect(body.config).toMatchObject({ repo: 'org/repo', autoSync: true });
    });

    it('update stores github settings', async () => {
      const res = await handleSDKEditor(
        jsonReq('github/update', { repo: 'a/b', autoSync: false }),
        makeCtx(makeEnv()),
        'github/update',
      );
      expect((await readJson(res)).success).toBe(true);
    });
  });

  describe('collaborators editor', () => {
    it('get lists collaborators', async () => {
      const env = makeEnv({
        collaborators: [
          {
            email: 'a@x.com',
            role: 'editor',
            invited_at: 't',
            accepted_at: 't2',
            name: 'A',
            picture: null,
          },
        ],
      });
      const body = await readJson(
        await handleSDKEditor(new Request('https://x'), makeCtx(env), 'collaborators/get'),
      );
      expect(body.collaborators).toEqual([
        expect.objectContaining({ email: 'a@x.com', accepted: true }),
      ]);
    });

    it('invite requires email and role', async () => {
      const res = await handleSDKEditor(
        jsonReq('collaborators/invite', { email: 'a@x.com' }),
        makeCtx(makeEnv()),
        'collaborators/invite',
      );
      expect(res.status).toBe(400);
    });

    it('invite, update, and remove', async () => {
      const env = makeEnv();
      for (const [action, body] of [
        ['collaborators/invite', { email: 'b@x.com', role: 'viewer' }],
        ['collaborators/update', { email: 'b@x.com', role: 'editor' }],
        ['collaborators/remove', { email: 'b@x.com' }],
      ] as const) {
        const res = await handleSDKEditor(jsonReq(action, body), makeCtx(env), action);
        expect((await readJson(res)).success).toBe(true);
      }
    });

    it('rejects the owner role on invite (no privilege escalation)', async () => {
      const res = await handleSDKEditor(
        jsonReq('collaborators/invite', { email: 'c@x.com', role: 'owner' }),
        makeCtx(makeEnv()),
        'collaborators/invite',
      );
      expect(res.status).toBe(400);
      expect((await readJson(res)).code).toBe('INVALID_ROLE');
    });

    it('forbids non-owner editors from inviting', async () => {
      const res = await handleSDKEditor(
        jsonReq('collaborators/invite', { email: 'c@x.com', role: 'viewer' }),
        makeCtx(makeEnv(), baseComponent({ type: 'collaborators' }), 'editor'),
        'collaborators/invite',
      );
      expect(res.status).toBe(403);
      expect((await readJson(res)).code).toBe('FORBIDDEN');
    });

    it('cannot remove the owner', async () => {
      const env = makeEnv({ collaboratorRole: 'owner' });
      const res = await handleSDKEditor(
        jsonReq('collaborators/remove', { email: 'owner@x.com' }),
        makeCtx(env),
        'collaborators/remove',
      );
      expect(res.status).toBe(403);
    });
  });

  describe('agent editor', () => {
    it('get returns defaults without config row', async () => {
      const body = await readJson(
        await handleSDKEditor(new Request('https://x'), makeCtx(makeEnv()), 'agent/get'),
      );
      expect(body.config).toMatchObject({
        visitor: expect.objectContaining({ enabled: false }),
        admin: expect.objectContaining({ enabled: true }),
      });
    });

    it('get maps stored agent config', async () => {
      const env = makeEnv({
        agentConfig: {
          visitor_enabled: 1,
          visitor_system_prompt: 'hi',
          visitor_model: 'gpt-4',
          visitor_max_tokens: 1000,
          visitor_temperature: 0.5,
          visitor_context_json: 1,
          visitor_context_tables: '["t1"]',
          visitor_context_blobs: 0,
          admin_enabled: 0,
          admin_model: 'gpt-3',
        },
      });
      const body = await readJson(
        await handleSDKEditor(new Request('https://x'), makeCtx(env), 'agent/get'),
      );
      expect(body.config).toMatchObject({
        visitor: expect.objectContaining({
          enabled: true,
          context: { json: true, tables: ['t1'], blobs: false },
        }),
        admin: { enabled: false, model: 'gpt-3' },
      });
    });

    it('update persists agent settings', async () => {
      const res = await handleSDKEditor(
        jsonReq('agent/update', {
          visitor: { enabled: true, context: { json: true, tables: ['x'] } },
          admin: { enabled: true },
        }),
        makeCtx(makeEnv()),
        'agent/update',
      );
      expect((await readJson(res)).success).toBe(true);
    });
  });

  describe('slides editor', () => {
    it('get returns presentation and slides', async () => {
      const env = makeEnv({
        presentationConfig: {
          title: 'Deck',
          aspect_ratio: '4:3',
          default_transition: 'slide',
          auto_play_interval: 5,
        },
        slides: [
          {
            id: 's1',
            position: 1,
            content_html: '<p>Hi</p>',
            background: null,
            transition_type: 'fade',
            transition_duration: 300,
            hidden: 0,
            speaker_notes: 'note',
          },
        ],
      });
      const body = await readJson(
        await handleSDKEditor(new Request('https://x'), makeCtx(env), 'slides/get'),
      );
      expect(body.presentation).toMatchObject({ title: 'Deck', aspectRatio: '4:3' });
      expect(body.slides).toEqual([
        expect.objectContaining({
          id: 's1',
          transition: { type: 'fade', duration: 300 },
          speakerNotes: 'note',
        }),
      ]);
    });

    it('config, add, update, reorder, and delete slides', async () => {
      const env = makeEnv({ maxSlidePosition: { max_pos: 2 } });

      await handleSDKEditor(
        jsonReq('slides/config', { title: 'T', aspectRatio: '16:9' }),
        makeCtx(env),
        'slides/config',
      );

      const add = await readJson(
        await handleSDKEditor(
          jsonReq('slides/add', { content: '<div/>', position: 3 }),
          makeCtx(env),
          'slides/add',
        ),
      );
      expect(add.id).toMatch(/^slide_/);

      await handleSDKEditor(
        jsonReq('slides/update', {
          id: 's1',
          content: '<div/>',
          hidden: true,
          transition: { type: 'zoom', duration: 200 },
        }),
        makeCtx(env),
        'slides/update',
      );

      await handleSDKEditor(
        jsonReq('slides/reorder', { slideIds: ['s2', 's1'] }),
        makeCtx(env),
        'slides/reorder',
      );

      const del = await handleSDKEditor(
        jsonReq('slides/delete', { id: 's1' }),
        makeCtx(env),
        'slides/delete',
      );
      expect((await readJson(del)).success).toBe(true);
    });

    it('add uses next position when position omitted', async () => {
      const env = makeEnv({ maxSlidePosition: { max_pos: 4 } });
      const body = await readJson(
        await handleSDKEditor(
          jsonReq('slides/add', {}),
          makeCtx(env),
          'slides/add',
        ),
      );
      expect(body.success).toBe(true);
    });
  });

  describe('binding editor', () => {
    it('get describes binding metadata', async () => {
      const component = baseComponent({
        type: 'binding',
        name: 'revenue',
        config: { binding: 'json:revenue.total', display: 'Revenue' },
      });
      const body = await readJson(
        await handleSDKEditor(new Request('https://x'), makeCtx(makeEnv(), component), 'binding/get'),
      );
      expect(body.binding).toMatchObject({
        raw: 'json:revenue.total',
        type: 'json',
        sources: ['json:revenue'],
      });
    });

    it('resolve returns empty sources when binding missing', async () => {
      const body = await readJson(
        await handleSDKEditor(
          new Request('https://x'),
          makeCtx(makeEnv(), baseComponent({ type: 'binding', config: {} })),
          'binding/resolve',
        ),
      );
      expect(body.sources).toEqual([]);
    });

    it('resolve fetches json source data', async () => {
      const component = baseComponent({
        type: 'binding',
        config: { binding: 'json:metrics' },
      });
      const env = makeEnv({ jsonValue: { value: '{"n":1}' } });
      const body = await readJson(
        await handleSDKEditor(new Request('https://x'), makeCtx(env, component), 'binding/resolve'),
      );
      expect(body.sources).toEqual([
        expect.objectContaining({ type: 'json', name: 'metrics', data: { n: 1 } }),
      ]);
    });

    it('resolve fetches table row counts', async () => {
      const component = baseComponent({
        type: 'binding',
        config: { binding: 'table:orders' },
      });
      const env = makeEnv({ tableRowCount: 3 });
      const body = await readJson(
        await handleSDKEditor(new Request('https://x'), makeCtx(env, component), 'binding/resolve'),
      );
      expect(body.sources).toEqual([
        expect.objectContaining({ type: 'table', name: 'orders', data: { rowCount: 3 } }),
      ]);
    });

    it('get classifies computed and multi binding prefixes', async () => {
      const computed = await readJson(
        await handleSDKEditor(
          new Request('https://x'),
          makeCtx(
            makeEnv(),
            baseComponent({ type: 'binding', config: { binding: 'computed:sum:json:a+table:b' } }),
          ),
          'binding/get',
        ),
      );
      expect((computed.binding as { type: string }).type).toBe('computed');

      const multi = await readJson(
        await handleSDKEditor(
          new Request('https://x'),
          makeCtx(
            makeEnv(),
            baseComponent({ type: 'binding', config: { binding: 'multi:merge:json:x|table:y' } }),
          ),
          'binding/get',
        ),
      );
      expect((multi.binding as { type: string }).type).toBe('multi');
    });

    it('get detects table and unknown binding types', async () => {
      const table = await readJson(
        await handleSDKEditor(
          new Request('https://x'),
          makeCtx(
            makeEnv(),
            baseComponent({ type: 'binding', config: { binding: 'table:sales' } }),
          ),
          'binding/get',
        ),
      );
      expect((table.binding as { type: string }).type).toBe('table');

      const unknown = await readJson(
        await handleSDKEditor(
          new Request('https://x'),
          makeCtx(makeEnv(), baseComponent({ type: 'binding', config: { binding: 'widget:x' } })),
          'binding/get',
        ),
      );
      expect((unknown.binding as { type: string }).type).toBe('unknown');
    });

    it('rejects unknown binding action', async () => {
      const res = await handleSDKEditor(
        new Request('https://x'),
        makeCtx(makeEnv(), baseComponent({ type: 'binding' })),
        'binding/sync',
      );
      expect(res.status).toBe(400);
    });
  });

  describe('error handling', () => {
    it('returns generic 500 without leaking internal error details when a handler throws', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const env = makeEnv();
      const db = env.DB as unknown as { prepare: ReturnType<typeof vi.fn> };
      db.prepare.mockImplementation(() => {
        throw new Error('D1_ERROR: no such table: secret_internal');
      });

      const res = await handleSDKEditor(
        new Request('https://x'),
        makeCtx(env),
        'json/get',
      );

      expect(res.status).toBe(500);
      const body = await readJson(res);
      expect(body).toEqual({
        success: false,
        error: 'SDK editor failed',
        code: 'INTERNAL_ERROR',
      });
      expect(String(body.error)).not.toContain('D1_ERROR');
      expect(consoleError).toHaveBeenCalled();
      expect(consoleError.mock.calls[0][0]).toMatchObject({
        level: 'error',
        message: 'SDK editor handler threw',
        event: 'editor.sdk_editor_error',
        artifact_id: ARTIFACT_ID,
        sdk_type: 'json',
        error_message: 'D1_ERROR: no such table: secret_internal',
      });
    });
  });
});
