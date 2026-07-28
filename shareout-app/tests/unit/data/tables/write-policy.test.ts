import { describe, expect, it, vi } from 'vitest';
import {
  mayWriteTable,
  tableWriteRoleFromManifest,
  resolveTableWriteRole,
  denyTableWrite,
} from '../../../../src/data/tables/write-policy';
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';

describe('tableWriteRoleFromManifest', () => {
  it('defaults to any when missing or unparseable', () => {
    expect(tableWriteRoleFromManifest(null, 't')).toBe('any');
    expect(tableWriteRoleFromManifest('not-json', 't')).toBe('any');
    expect(tableWriteRoleFromManifest('{}', 't')).toBe('any');
  });

  it('reads sources.tables.<name>.write when valid', () => {
    const m = JSON.stringify({
      sources: {
        tables: {
          approvals: { write: 'owner', schema: [] },
          notes: { write: 'collaborator' },
          junk: { write: 'nope' },
        },
      },
    });
    expect(tableWriteRoleFromManifest(m, 'approvals')).toBe('owner');
    expect(tableWriteRoleFromManifest(m, 'notes')).toBe('collaborator');
    expect(tableWriteRoleFromManifest(m, 'junk')).toBe('any');
    expect(tableWriteRoleFromManifest(m, 'missing')).toBe('any');
  });
});

describe('mayWriteTable', () => {
  const owner = { isOwner: true, isArtifactOwner: true };
  const editor = { isOwner: true, isArtifactOwner: false };
  const viewer = { isOwner: false, isArtifactOwner: false };

  it('any allows everyone', () => {
    expect(mayWriteTable('any', viewer)).toBe(true);
    expect(mayWriteTable('any', editor)).toBe(true);
    expect(mayWriteTable('any', owner)).toBe(true);
  });

  it('collaborator allows owner and editor, not viewer', () => {
    expect(mayWriteTable('collaborator', viewer)).toBe(false);
    expect(mayWriteTable('collaborator', editor)).toBe(true);
    expect(mayWriteTable('collaborator', owner)).toBe(true);
  });

  it('owner allows only the true artifact owner', () => {
    expect(mayWriteTable('owner', viewer)).toBe(false);
    expect(mayWriteTable('owner', editor)).toBe(false);
    expect(mayWriteTable('owner', owner)).toBe(true);
  });
});

describe('resolveTableWriteRole', () => {
  it('loads production deployment manifest', async () => {
    const prepare = vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({
          manifest_json: JSON.stringify({
            sources: { tables: { approvals: { write: 'owner' } } },
          }),
        })),
      })),
    }));
    const env = { DB: { prepare } } as unknown as Env;
    await expect(resolveTableWriteRole(env, 'art_1', 'approvals')).resolves.toBe('owner');
    expect(prepare).toHaveBeenCalledOnce();
  });
});

describe('denyTableWrite', () => {
  function ctx(over: Partial<DataContext> = {}): DataContext {
    return {
      artifactId: 'art_1',
      workspaceId: '',
      artifact: {
        id: 'art_1',
        name: 'A',
        visibility: 'private',
        auth_method: 'google',
        workspace_id: null,
        owner_id: 'usr_own',
      },
      db: {} as DataContext['db'],
      env: {
        DB: {
          prepare: vi.fn(() => ({
            bind: vi.fn(() => ({
              first: vi.fn(async () => ({
                manifest_json: JSON.stringify({
                  sources: { tables: { approvals: { write: 'owner' } } },
                }),
              })),
            })),
          })),
        },
      } as unknown as Env,
      origin: null,
      isOwner: false,
      isArtifactOwner: false,
      ...over,
    };
  }

  it('skips the gate for trusted internal contexts (no auth flags)', async () => {
    const c = ctx();
    delete c.isOwner;
    delete c.isArtifactOwner;
    await expect(denyTableWrite(c, 'approvals')).resolves.toBeNull();
  });

  it('returns TABLE_WRITE_FORBIDDEN for a viewer on write:owner', async () => {
    const err = await denyTableWrite(ctx({ isOwner: false, isArtifactOwner: false }), 'approvals');
    expect(err?.code).toBe('TABLE_WRITE_FORBIDDEN');
    expect(err?.status).toBe(403);
  });

  it('allows the true owner on write:owner', async () => {
    await expect(
      denyTableWrite(ctx({ isOwner: true, isArtifactOwner: true }), 'approvals'),
    ).resolves.toBeNull();
  });

  it('blocks an editor on write:owner', async () => {
    const err = await denyTableWrite(ctx({ isOwner: true, isArtifactOwner: false }), 'approvals');
    expect(err?.code).toBe('TABLE_WRITE_FORBIDDEN');
  });
});
