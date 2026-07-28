// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { listFilesTool, readFileTool } from '../../../src/chat-agent/tools/files';
import { createArtifactTool } from '../../../src/chat-agent/tools/build';
import { selectTools, ACCOUNT_TOOLS } from '../../../src/chat-agent/tools/index';
import type { Env } from '../../../src/types';
import type { ToolContext } from '../../../src/chat-agent/tools/types';

const PERSONAL_BUCKET = { id: 'art_personal', name: 'My Assets', visibility: 'unlisted', auth_method: null, workspace_id: null, owner_id: 'usr_1' };
const WS_BUCKET = { id: 'art_ws', name: 'Workspace Assets', visibility: 'unlisted', auth_method: null, workspace_id: 'wsp_1', owner_id: 'usr_1' };

function mkCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const fileRows: Record<string, unknown>[] = [];
  const r2 = new Map<string, ArrayBuffer>();

  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('workspace_members')) return { '1': 1 };
          if (sql.includes('FROM asset_buckets')) {
            if (sql.includes('b.workspace_id IS NULL')) return PERSONAL_BUCKET;
            if (sql.includes('b.workspace_id = ?')) return WS_BUCKET;
          }
          if (sql.includes('AND b.id = ?')) {
            const fileId = args[args.length - 1];
            return fileRows.find(r => r.id === fileId) ?? null;
          }
          if (sql.includes('SELECT r2_key FROM blobs')) {
            const fileId = args[0];
            const row = fileRows.find(r => r.id === fileId);
            return row ? { r2_key: row.r2_key } : null;
          }
          return null;
        }),
        all: vi.fn(async () => ({ results: fileRows })),
        run: vi.fn(async () => ({ success: true })),
      })),
    })),
    batch: vi.fn(async () => []),
  };

  const ARTIFACTS = {
    get: vi.fn(async (key: string) => {
      const bytes = r2.get(key);
      if (!bytes) return null;
      return { arrayBuffer: async () => bytes };
    }),
    put: vi.fn(async (key: string, body: ArrayBuffer) => { r2.set(key, body); }),
  };

  const env = { DB, ARTIFACTS } as unknown as Env;
  const ctx: ToolContext = {
    env,
    userId: 'usr_1',
    selectedWorkspaceId: 'wsp_1',
    ...overrides,
  };

  return Object.assign(ctx, {
    seedFile(row: Record<string, unknown>, bytes: ArrayBuffer) {
      fileRows.push(row);
      r2.set(String(row.r2_key), bytes);
    },
  });
}

describe('file tools registration', () => {
  it('includes list_files and read_file in account tools', () => {
    const names = selectTools({ canQueryConnections: false, canSchedule: false, canBuild: false }).map(t => t.name);
    for (const t of ACCOUNT_TOOLS.filter(x => x.name === 'list_files' || x.name === 'read_file')) {
      expect(names).toContain(t.name);
    }
  });
});

describe('read_file authorization', () => {
  it('rejects a blob outside the caller buckets', async () => {
    const ctx = mkCtx();
    const out = await readFileTool.execute(ctx, { file_id: 'blob_foreign' });
    expect(out).toEqual({ error: 'No file "blob_foreign" in your library.' });
  });

  it('reads an authorized blob and summarizes content', async () => {
    const ctx = mkCtx() as ReturnType<typeof mkCtx>;
    ctx.seedFile({
      id: 'blob_ok',
      filename: 'notes.txt',
      mime_type: 'text/plain',
      size_bytes: 5,
      created_at: '2024-01-01T00:00:00.000Z',
      artifact_id: PERSONAL_BUCKET.id,
      source: null,
      sender: null,
      subject: null,
      body_text: null,
      used_for: null,
      r2_key: 'art_personal/blobs/blob_ok/notes.txt',
    }, new TextEncoder().encode('hello').buffer);

    const out = await readFileTool.execute(ctx, { file_id: 'blob_ok' });
    expect(out).toMatchObject({ filename: 'notes.txt', content: 'hello' });
  });
});

describe('list_files', () => {
  it('returns empty note when no files exist', async () => {
    const ctx = mkCtx();
    const out = await listFilesTool.execute(ctx, {});
    expect(out).toEqual({ files: [], note: 'No files in the library yet.' });
  });
});

describe('create_artifact provenance', () => {
  it('passes source_file_id through the proposal', async () => {
    const out = await createArtifactTool.execute(
      { env: {} as never, userId: 'u1' },
      { prompt: 'build a dashboard from the spreadsheet', source_file_id: 'blob_abc' },
    );
    expect(out).toEqual({
      __propose: {
        kind: 'build_artifact',
        name: 'build a dashboard from the spreadsheet',
        prompt: 'build a dashboard from the spreadsheet',
        source_file_id: 'blob_abc',
      },
    });
  });
});
