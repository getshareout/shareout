import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareOut } from '../src/index';
import { setPostMessageData } from '../src/internal/embedded-init';

describe('ShareOut editor mode (offline preview)', () => {
  beforeEach(() => {
    setPostMessageData({
      artifactId: 'preview',
      baseUrl: 'https://shareout.test',
      editorMode: true,
      json: { revenue: { total: 5 } },
      tables: { rooms: { rows: [{ id: 'r1' }], total: 1, hasMore: false } },
      connections: { warehouse: [{ region: 'EU', units: 42 }] },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves seeded data with NO network — even for sorted/filtered queries the seed key does not match', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network must not be called in editor mode');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const sdk = await ShareOut.create();

    // Seeded json resolves; unseeded json resolves to null.
    expect(await sdk.json.get('revenue')).toEqual({ total: 5 });
    expect(await sdk.json.get('missing')).toBeNull();

    // A sorted query does NOT match the default seed cache key, yet still resolves
    // to the seeded rows offline (this is the case that hangs without editor mode).
    const rooms = await sdk.table('rooms').find({}).sort('createdAt', 'desc').exec();
    expect(rooms).toEqual([{ id: 'r1' }]);

    // An unseeded table resolves to empty (artifact renders its empty state, no hang).
    const empty = await sdk.table('nope').find().exec();
    expect(empty).toEqual([]);

    // A seeded live connector resolves to its sample rows (the mock mechanism), so a
    // connector-backed chart previews populated. Any query string returns the same seed.
    const seeded = await sdk.connection('warehouse').fetch('SELECT * FROM sales');
    expect(seeded).toEqual([{ region: 'EU', units: 42 }]);

    // An unseeded connector resolves to empty (chart renders empty, no throw).
    const emptyConn = await sdk.connection('unknown').fetch('SELECT 1');
    expect(emptyConn).toEqual([]);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
