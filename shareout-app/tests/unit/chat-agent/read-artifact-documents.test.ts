// read_artifact on a document page reads it like the same file in Assets (toMarkdown),
// never as raw bytes — so a PDF published as an artifact is as readable to the agent.
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { readReportText } from '../../../src/chat-agent/tools/artifacts';

function envFor(asset: { mime: string; size_bytes: number; body: string }, ai?: unknown): Env {
  const rows: Record<string, unknown> = {
    deployments: { version_id: 'ver_1' },
    versions: { entrypoint: 'deck.pdf' },
    assets: { r2_key: 'k/deck', mime: asset.mime, size_bytes: asset.size_bytes },
  };
  const prepare = (sql: string) => {
    const table = /FROM (\w+)/.exec(sql)![1];
    const stmt = { bind: () => stmt, first: async () => rows[table] ?? null };
    return stmt;
  };
  const bytes = new TextEncoder().encode(asset.body);
  return {
    DB: { prepare },
    ARTIFACTS: { get: vi.fn(async () => ({ text: async () => asset.body, arrayBuffer: async () => bytes.buffer })) },
    AI: ai,
  } as unknown as Env;
}

describe('readReportText for document artifacts', () => {
  it('reads a PDF page through toMarkdown', async () => {
    const toMarkdown = vi.fn(async () => ({ format: 'markdown', data: '# Deck\n\nRevenue grew 12%.' }));
    const text = await readReportText(envFor({ mime: 'application/pdf', size_bytes: 9, body: '%PDF-1.7 stream' }, { toMarkdown }), 'art_1');
    expect(text).toBe('# Deck\n\nRevenue grew 12%.');
    expect(toMarkdown).toHaveBeenCalledWith(expect.objectContaining({ name: 'deck.pdf' }));
  });

  it('never returns raw PDF bytes when it cannot convert', async () => {
    expect(await readReportText(envFor({ mime: 'application/pdf', size_bytes: 9, body: '%PDF-1.7 stream' }), 'art_1')).toBeNull();
  });

  it('skips a binary over the in-isolate size cap without fetching it', async () => {
    const env = envFor({ mime: 'application/pdf', size_bytes: 30_000_000, body: '' }, { toMarkdown: vi.fn() });
    expect(await readReportText(env, 'art_1')).toBeNull();
    expect(env.ARTIFACTS.get).not.toHaveBeenCalled();
  });

  it('still reads text pages as text', async () => {
    expect(await readReportText(envFor({ mime: 'text/markdown', size_bytes: 5, body: '# Hi' }), 'art_1')).toBe('# Hi');
  });
});
