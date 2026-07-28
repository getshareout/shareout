import { afterEach, describe, expect, it, vi } from 'vitest';
import { getViewerTracking, trackViewerView } from '../../src/view-tracking';
import type { Env } from '../../src/types';

const ARTIFACT_ID = 'art_1';
const EMAIL = 'viewer@example.com';

type DbHandlers = {
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
};

function makeDbMock(handlers: DbHandlers = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        all: vi.fn(async () => handlers.all?.(sql, ...bindArgs) ?? { results: [] }),
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true, meta: { changes: 1 } }),
      })),
    })),
  } as unknown as Env['DB'];
}

function makeEnv(db: Env['DB']): Env {
  return { DB: db } as Env;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('trackViewerView', () => {
  it('inserts a view event for any authenticated viewer', async () => {
    const run = vi.fn(async () => ({ success: true, meta: { changes: 1 } }));
    const db = makeDbMock({ run });

    await trackViewerView(makeEnv(db), ARTIFACT_ID, EMAIL, '/dashboard');

    expect(run).toHaveBeenCalled();
  });

  it('skips tracking for the artifact owner', async () => {
    const run = vi.fn(async () => ({ success: true, meta: { changes: 1 } }));
    const db = makeDbMock({ run });

    await trackViewerView(makeEnv(db), ARTIFACT_ID, EMAIL, '/', true);
    expect(run).not.toHaveBeenCalled();
  });

  it('uses default path when omitted', async () => {
    const bind = vi.fn(() => ({
      run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
    }));
    const db = {
      prepare: vi.fn(() => ({ bind })),
    } as unknown as Env['DB'];

    await trackViewerView(makeEnv(db), ARTIFACT_ID, EMAIL);
    expect(bind).toHaveBeenCalledWith(expect.any(String), ARTIFACT_ID, EMAIL, '/');
  });

  it('silently fails when DB throws', async () => {
    const db = {
      prepare: vi.fn(() => {
        throw new Error('DB error');
      }),
    } as unknown as Env['DB'];

    await expect(trackViewerView(makeEnv(db), ARTIFACT_ID, EMAIL)).resolves.toBeUndefined();
  });
});

describe('getViewerTracking', () => {
  it('maps viewer stats including resolved name', async () => {
    const db = makeDbMock({
      all: () => ({
        results: [
          {
            email: 'viewer@example.com',
            name: 'Vera Viewer',
            role: 'viewer',
            view_count: 3,
            first_viewed_at: 1000,
            last_viewed_at: 2000,
          },
          {
            email: 'editor@example.com',
            name: null,
            role: 'editor',
            view_count: 0,
            first_viewed_at: null,
            last_viewed_at: null,
          },
        ],
      }),
    });

    const rows = await getViewerTracking(makeEnv(db), ARTIFACT_ID);
    expect(rows).toEqual([
      {
        email: 'viewer@example.com',
        name: 'Vera Viewer',
        role: 'viewer',
        hasViewed: true,
        firstViewedAt: 1000,
        lastViewedAt: 2000,
        viewCount: 3,
      },
      {
        email: 'editor@example.com',
        name: null,
        role: 'editor',
        hasViewed: false,
        firstViewedAt: null,
        lastViewedAt: null,
        viewCount: 0,
      },
    ]);
  });

  it('returns empty array on DB error', async () => {
    const db = {
      prepare: vi.fn(() => {
        throw new Error('fail');
      }),
    } as unknown as Env['DB'];

    const rows = await getViewerTracking(makeEnv(db), ARTIFACT_ID);
    expect(rows).toEqual([]);
  });

  it('returns empty array when no viewers', async () => {
    const db = makeDbMock({ all: () => ({ results: [] }) });
    const rows = await getViewerTracking(makeEnv(db), ARTIFACT_ID);
    expect(rows).toEqual([]);
  });
});
