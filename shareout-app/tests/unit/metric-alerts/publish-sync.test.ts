import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { parseMetricsBlock, syncMetricsFromHtml } from '../../../src/metric-alerts/definitions';

const block = (json: string) => `<!doctype html><html><head>
<script type="shareout/metrics">${json}</script>
</head><body>hi</body></html>`;

const VALID = JSON.stringify({
  metrics: [
    { id: 'revenue', label: 'Revenue', format: 'currency:USD', source: { type: 'json_path', key: 'metrics', path: '$.revenue' } },
  ],
});

describe('parseMetricsBlock', () => {
  it('extracts the metrics array from the script block', () => {
    const out = parseMetricsBlock(block(VALID));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('revenue');
  });

  it('accepts a bare array too', () => {
    const out = parseMetricsBlock(block('[{"id":"x","label":"X","source":{"type":"table_count","table":"t"}}]'));
    expect(out).toHaveLength(1);
  });

  it('returns [] when there is no block', () => {
    expect(parseMetricsBlock('<html></html>')).toEqual([]);
  });

  it('returns [] on malformed JSON (never throws)', () => {
    expect(parseMetricsBlock(block('{not json'))).toEqual([]);
  });
});

// env.DB stub routed by SQL substring.
function db(handlers: Record<string, unknown>) {
  const runSpy = vi.fn(async () => ({ meta: { changes: 1 } }));
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          for (const [needle, val] of Object.entries(handlers)) if (sql.includes(needle)) return val;
          return null;
        }),
        run: runSpy,
      })),
    })),
  };
  return { env: { DB } as unknown as Env, runSpy };
}

describe('syncMetricsFromHtml', () => {
  it('upserts a valid declared metric', async () => {
    const { env, runSpy } = db({ 'workspace_id FROM artifacts': { workspace_id: 'ws_1' }, 'COUNT(*)': { n: 0 } });
    const res = await syncMetricsFromHtml(env, 'art_1', block(VALID), 'user_1');
    expect(res.synced).toBe(1);
    // INSERT ran (existing lookup returned null → insert path).
    expect(runSpy).toHaveBeenCalled();
  });

  it('skips entries with an invalid source or missing fields', async () => {
    const html = block(JSON.stringify({
      metrics: [
        { id: 'ok', label: 'OK', source: { type: 'table_count', table: 't' } },
        { id: 'bad', label: 'Bad', source: { type: 'nonsense' } },
        { id: 'no-label', source: { type: 'table_count', table: 't' } },
      ],
    }));
    const { env } = db({ 'workspace_id FROM artifacts': { workspace_id: null }, 'COUNT(*)': { n: 0 } });
    const res = await syncMetricsFromHtml(env, 'art_1', html, 'user_1');
    expect(res.synced).toBe(1);
  });

  it('does nothing when there is no metrics block', async () => {
    const { env, runSpy } = db({});
    const res = await syncMetricsFromHtml(env, 'art_1', '<html></html>', 'user_1');
    expect(res.synced).toBe(0);
    expect(runSpy).not.toHaveBeenCalled();
  });
});
