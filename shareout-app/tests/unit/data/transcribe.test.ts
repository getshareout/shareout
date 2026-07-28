import { describe, expect, it, vi } from 'vitest';
import { transcribeAudioBytes } from '../../../src/data/transcribe';
import type { Env } from '../../../src/types';

interface UsageRow {
  workspace_id: string | null;
  user_id: string | null;
  kind: string;
  units: number;
  base_cost_micro_usd: number;
  source: string | null;
}

function makeEnv(aiOut: unknown, usage: UsageRow[]): Env {
  return {
    AI: { run: vi.fn().mockResolvedValue(aiOut) },
    DB: {
      prepare: () => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            usage.push({
              workspace_id: args[1] as string | null,
              user_id: args[2] as string | null,
              kind: args[3] as string,
              units: args[5] as number,
              base_cost_micro_usd: args[7] as number,
              source: args[8] as string | null,
            });
          },
        }),
      }),
    },
  } as unknown as Env;
}

const bytes = (n: number): ArrayBuffer => new Uint8Array(n).fill(7).buffer;

describe('transcribeAudioBytes', () => {
  it('transcribes (turbo shape) and records track-only usage tagged by source', async () => {
    const usage: UsageRow[] = [];
    const env = makeEnv({ transcription_info: { text: 'hello world' } }, usage);
    const r = await transcribeAudioBytes(env, bytes(1024), {
      durationSec: 8, userId: 'u1', workspaceId: 'wsp_9', source: 'web',
    });
    expect(r.text).toBe('hello world');
    expect(usage).toEqual([{
      workspace_id: 'wsp_9', user_id: 'u1', kind: 'whisper_transcribe',
      units: 8, base_cost_micro_usd: 60, source: 'web',
    }]);
  });

  it('accepts the flat whisper text shape', async () => {
    const usage: UsageRow[] = [];
    const env = makeEnv({ text: 'flat' }, usage);
    const r = await transcribeAudioBytes(env, bytes(64), { durationSec: 2, userId: 'u', workspaceId: null, source: 'web' });
    expect(r.text).toBe('flat');
  });

  it('rejects empty audio without calling AI', async () => {
    const usage: UsageRow[] = [];
    const env = makeEnv({ text: 'x' }, usage);
    const r = await transcribeAudioBytes(env, bytes(0), { durationSec: 1, userId: 'u', workspaceId: null, source: 'web' });
    expect(r.error).toBeTruthy();
    expect(env.AI!.run).not.toHaveBeenCalled();
    expect(usage).toHaveLength(0);
  });

  it('rejects audio longer than the cap', async () => {
    const usage: UsageRow[] = [];
    const env = makeEnv({ text: 'x' }, usage);
    const r = await transcribeAudioBytes(env, bytes(64), { durationSec: 9999, userId: 'u', workspaceId: null, source: 'web' });
    expect(r.error).toBeTruthy();
    expect(env.AI!.run).not.toHaveBeenCalled();
  });

  it('errors (no text) on an empty transcript', async () => {
    const usage: UsageRow[] = [];
    const env = makeEnv({ transcription_info: { text: '  ' } }, usage);
    const r = await transcribeAudioBytes(env, bytes(64), { durationSec: 3, userId: 'u', workspaceId: null, source: 'web' });
    expect(r.error).toBeTruthy();
    expect(r.text).toBeUndefined();
  });

  it('errors when the AI binding is missing', async () => {
    const env = makeEnv({ text: 'x' }, []);
    (env as { AI?: unknown }).AI = undefined;
    const r = await transcribeAudioBytes(env, bytes(64), { durationSec: 3, userId: 'u', workspaceId: null, source: 'web' });
    expect(r.error).toBeTruthy();
  });
});
