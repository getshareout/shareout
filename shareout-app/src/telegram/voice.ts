import type { Env } from '../types';
import type { TelegramAudio } from './types';
import { PERSONAL_SCOPE, type WorkspaceSelection } from '../chat-platforms/types';
import { getFilePath, downloadFile } from './client';
import { transcribeAudioBytes, MAX_AUDIO_SECONDS, MAX_AUDIO_BYTES, type TranscribeResult } from '../data/transcribe';

export type { TranscribeResult };

/**
 * Download a Telegram voice/audio file and transcribe it via the shared Whisper
 * core. Records a track-only usage row (no balance debit).
 */
export async function transcribeTelegramAudio(
  env: Env,
  audio: TelegramAudio,
  ctx: { userId: string; selectedWorkspaceId: WorkspaceSelection }
): Promise<TranscribeResult> {
  if (!env.AI) return { error: 'Voice transcription is unavailable right now.' };
  if ((audio.duration ?? 0) > MAX_AUDIO_SECONDS) {
    return { error: 'That recording is too long for me to transcribe. Try under 10 minutes.' };
  }
  if ((audio.file_size ?? 0) > MAX_AUDIO_BYTES) {
    return { error: 'That audio file is too large for me to transcribe.' };
  }

  const filePath = await getFilePath(env, audio.file_id);
  if (!filePath) return { error: 'I couldn’t fetch that audio. Mind resending it?' };
  const buf = await downloadFile(env, filePath);
  if (!buf) return { error: 'I couldn’t download that audio. Mind resending it?' };

  const workspaceId =
    typeof ctx.selectedWorkspaceId === 'string' && ctx.selectedWorkspaceId !== PERSONAL_SCOPE
      ? ctx.selectedWorkspaceId
      : null;
  return transcribeAudioBytes(env, buf, {
    durationSec: audio.duration ?? 0,
    userId: ctx.userId,
    workspaceId,
    source: 'telegram',
  });
}
