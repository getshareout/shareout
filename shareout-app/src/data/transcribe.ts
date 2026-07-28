import type { Env } from '../types';
import { recordAiUsage, whisperCostMicroUsd } from './ai-usage';

// whisper-large-v3-turbo auto-detects language (omit `language`), which we want
// for mixed Spanish/English. It takes base64-encoded audio and returns the text
// under transcription_info.text (older whisper returns a flat `text`).
export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

// Guards against a long clip blowing past Workers AI limits / running up cost.
export const MAX_AUDIO_SECONDS = 600;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export interface TranscribeResult {
  text?: string;
  error?: string;
}

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function extractText(out: unknown): string {
  if (out && typeof out === 'object') {
    const o = out as { text?: unknown; transcription_info?: { text?: unknown } };
    if (typeof o.transcription_info?.text === 'string') return o.transcription_info.text;
    if (typeof o.text === 'string') return o.text;
  }
  return '';
}

/**
 * Transcribe raw audio bytes with Workers AI Whisper and record a track-only usage
 * row (no balance debit). Surface-agnostic core shared by Telegram voice notes and
 * the web chat mic. Returns the transcript or a user-facing error string.
 */
export async function transcribeAudioBytes(
  env: Env,
  bytes: ArrayBuffer,
  opts: {
    durationSec?: number;
    userId: string | null;
    workspaceId: string | null;
    source: string;
  }
): Promise<TranscribeResult> {
  if (!env.AI) return { error: 'Voice transcription is unavailable right now.' };
  if ((opts.durationSec ?? 0) > MAX_AUDIO_SECONDS) {
    return { error: 'That recording is too long to transcribe. Try under 10 minutes.' };
  }
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    return { error: 'That audio is too large to transcribe.' };
  }
  if (bytes.byteLength === 0) return { error: 'That recording was empty.' };

  let text = '';
  try {
    const out = await env.AI.run(WHISPER_MODEL, { audio: bytesToBase64(bytes) } as never);
    text = extractText(out).trim();
  } catch {
    return { error: 'I had trouble transcribing that. Could you try again?' };
  }

  const seconds = opts.durationSec ?? 0;
  await recordAiUsage(env, {
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    kind: 'whisper_transcribe',
    model: WHISPER_MODEL,
    units: seconds,
    unitKind: 'audio_seconds',
    baseCostMicroUsd: whisperCostMicroUsd(seconds),
    source: opts.source,
  }).catch(() => {});

  if (!text) return { error: 'I couldn’t make out any words in that recording.' };
  return { text };
}
