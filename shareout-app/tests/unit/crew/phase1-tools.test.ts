import { describe, it, expect, vi, beforeEach } from 'vitest';

const deliverMock = vi.fn();
const validateMock = vi.fn();
vi.mock('../../../src/delivery/registry', () => ({
  getDestination: () => ({ kind: 'slack', validate: validateMock, deliver: deliverMock }),
}));

import { jsonSetTool } from '../../../src/crew/tools/json-set';
import { notifySendTool } from '../../../src/crew/tools/notify-send';

function fakeDb() {
  const store = new Map<string, { id: string; value: string }>();
  return {
    store,
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => ({
          async first() {
            if (sql.startsWith('SELECT value')) { const r = store.get(args[1] as string); return r ? { value: r.value } : null; }
            if (sql.startsWith('SELECT id')) { const r = store.get(args[1] as string); return r ? { id: r.id } : null; }
            return null;
          },
          async run() {
            if (sql.startsWith('INSERT')) { store.set(args[2] as string, { id: args[0] as string, value: args[3] as string }); }
            else if (sql.startsWith('UPDATE')) {
              const id = args[3] as string;
              for (const [k, v] of store) if (v.id === id) store.set(k, { id, value: args[0] as string });
            }
            return { meta: { changes: 1 } };
          },
        }),
      };
    },
  };
}

function ctx(db: unknown, viewerScope: unknown = null) {
  return {
    data: { db, artifactId: 'art_1', viewerScope, env: {} },
    principal: { ownerId: 'usr_owner', crewId: 'crew_1', runId: 'run_1', artifactId: 'art_1', workspaceId: 'wsp_1' },
    limits: {},
  } as never;
}

describe('json_set tool', () => {
  it('creates then replaces a key', async () => {
    const db = fakeDb();
    const r = await jsonSetTool.execute(ctx(db), { key: 'theme', value: { dark: true } });
    expect((r as { key: string }).key).toBe('theme');
    expect(JSON.parse(db.store.get('theme')!.value)).toEqual({ dark: true });

    await jsonSetTool.execute(ctx(db), { key: 'theme', value: { dark: false } });
    expect(JSON.parse(db.store.get('theme')!.value)).toEqual({ dark: false });
  });

  it('merges at a path into the key object', async () => {
    const db = fakeDb();
    await jsonSetTool.execute(ctx(db), { key: 'snap', value: [1], path: 'a' });
    await jsonSetTool.execute(ctx(db), { key: 'snap', value: [2], path: 'b' });
    expect(JSON.parse(db.store.get('snap')!.value)).toEqual({ a: [1], b: [2] });
  });

  it('refuses when a row-level access policy is active', async () => {
    const r = await jsonSetTool.execute(ctx(fakeDb(), { foo: 1 }), { key: 'x', value: 1 });
    expect((r as { error: string }).error).toMatch(/access policy/);
  });

  it('requires key and value', async () => {
    expect((await jsonSetTool.execute(ctx(fakeDb()), { value: 1 }) as { error: string }).error).toMatch(/key/);
    expect((await jsonSetTool.execute(ctx(fakeDb()), { key: 'x' }) as { error: string }).error).toMatch(/value/);
  });
});

describe('notify_send message passthrough', () => {
  beforeEach(() => {
    deliverMock.mockReset().mockResolvedValue({ success: true });
    validateMock.mockReset().mockResolvedValue(null);
  });

  it('surfaces a top-level message as the destination customMessage', async () => {
    const config: Record<string, unknown> = { connection: 'team', channelId: 'C1', mode: 'both' };
    await notifySendTool.execute(ctx(fakeDb()), { destination: 'slack', message: 'hi *there*', config });
    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect((deliverMock.mock.calls[0][2] as { customMessage: string }).customMessage).toBe('hi *there*');
  });

  it('does not override an explicit customMessage', async () => {
    const config: Record<string, unknown> = { connection: 'team', channelId: 'C1', customMessage: 'explicit' };
    await notifySendTool.execute(ctx(fakeDb()), { destination: 'slack', message: 'auto', config });
    expect((deliverMock.mock.calls[0][2] as { customMessage: string }).customMessage).toBe('explicit');
  });
});
