import { describe, expect, it, vi, afterEach } from 'vitest';
import { transcribeTelegramAudio } from '../../../src/telegram/voice';
import { PERSONAL_SCOPE } from '../../../src/chat-platforms/types';
import type { Env } from '../../../src/types';

afterEach(() => vi.unstubAllGlobals());

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
    TELEGRAM_BOT_TOKEN: 'tok',
    AI: { run: vi.fn().mockResolvedValue(aiOut) },
    DB: {
      prepare: () => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            // ai_usage_events insert order: id, workspace_id, user_id, kind, model, units, unit_kind, base_cost, source
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

// Mock Telegram getFile + file download.
function stubTelegramFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/getFile')) {
      return new Response(JSON.stringify({ result: { file_path: 'voice/file_1.oga' } }), { status: 200 });
    }
    // file download
    return new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 });
  }));
}

describe('transcribeTelegramAudio', () => {
  it('transcribes (turbo shape) and records track-only usage', async () => {
    stubTelegramFetch();
    const usage: UsageRow[] = [];
    const env = makeEnv({ transcription_info: { text: 'hola mundo' } }, usage);

    const result = await transcribeTelegramAudio(
      env,
      { file_id: 'f1', duration: 8 },
      { userId: 'usr_1', selectedWorkspaceId: 'wsp_9' }
    );

    expect(result.text).toBe('hola mundo');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      workspace_id: 'wsp_9',
      user_id: 'usr_1',
      kind: 'whisper_transcribe',
      units: 8,
      source: 'telegram',
    });
    // 8s * 7.5 micro-USD/s = 60
    expect(usage[0].base_cost_micro_usd).toBe(60);
  });

  it('falls back to flat text shape (base whisper)', async () => {
    stubTelegramFetch();
    const usage: UsageRow[] = [];
    const env = makeEnv({ text: 'flat shape' }, usage);
    const result = await transcribeTelegramAudio(env, { file_id: 'f1', duration: 2 }, { userId: 'u', selectedWorkspaceId: null });
    expect(result.text).toBe('flat shape');
  });

  it('maps personal scope to a null workspace in the ledger', async () => {
    stubTelegramFetch();
    const usage: UsageRow[] = [];
    const env = makeEnv({ text: 'hi' }, usage);
    await transcribeTelegramAudio(env, { file_id: 'f1', duration: 1 }, { userId: 'u', selectedWorkspaceId: PERSONAL_SCOPE });
    expect(usage[0].workspace_id).toBeNull();
  });

  it('rejects audio longer than the cap without calling AI', async () => {
    stubTelegramFetch();
    const usage: UsageRow[] = [];
    const env = makeEnv({ text: 'x' }, usage);
    const result = await transcribeTelegramAudio(env, { file_id: 'f1', duration: 9999 }, { userId: 'u', selectedWorkspaceId: null });
    expect(result.error).toBeTruthy();
    expect(env.AI!.run).not.toHaveBeenCalled();
    expect(usage).toHaveLength(0);
  });

  it('returns an error (no usage) when transcript is empty', async () => {
    stubTelegramFetch();
    const usage: UsageRow[] = [];
    const env = makeEnv({ transcription_info: { text: '   ' } }, usage);
    const result = await transcribeTelegramAudio(env, { file_id: 'f1', duration: 3 }, { userId: 'u', selectedWorkspaceId: null });
    expect(result.error).toBeTruthy();
    expect(result.text).toBeUndefined();
  });

  it('errors gracefully when AI binding is missing', async () => {
    const usage: UsageRow[] = [];
    const env = makeEnv({ text: 'x' }, usage);
    (env as { AI?: unknown }).AI = undefined;
    const result = await transcribeTelegramAudio(env, { file_id: 'f1', duration: 3 }, { userId: 'u', selectedWorkspaceId: null });
    expect(result.error).toBeTruthy();
  });
});
