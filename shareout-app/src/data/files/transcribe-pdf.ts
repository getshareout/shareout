// A document with no text layer (a scanned PDF, a Word file that is only pictures) read by
// a vision model into markdown. Last resort after the text extractors: costs model calls.
import type { Env } from '../../types';
import { getAIProvider, streamChat, type ChatImage } from '../agent/anthropic';
import type { AiMeter } from '../ai-usage';

// The request body carries the file as base64; keep well under provider limits (~32MB).
const MAX_BASE64_CHARS = 27_000_000;
const MAX_TOKENS = 16_000;
// A long scan runs past one reply's output cap: ask it to carry on this many more times.
const MAX_CONTINUATIONS = 4;
const MAX_IMAGES = 10;

const SYSTEM = `You transcribe a scanned document into clean markdown.
- Copy every word as written, in its original language. Do not summarize, translate or add commentary.
- Keep structure: headings, numbered lists, and tables as markdown tables.
- For a stamp, signature or drawing, write a short bracketed note like [firma] or [diagrama].
- Output only the markdown.`;

async function transcribeOne(env: Env, meter: AiMeter, part: ChatImage): Promise<string | null> {
  const ask = part.mediaType === 'application/pdf' ? 'Transcribe this document.' : 'Transcribe this image.';
  let out = '';
  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    const messages = round === 0
      ? [{ role: 'user' as const, content: ask, image: part }]
      : [{ role: 'user' as const, content: ask, image: part }, { role: 'assistant' as const, content: out }, { role: 'user' as const, content: 'Continue exactly where you stopped. Do not repeat anything.' }];
    let text = '';
    let truncated = false;
    for await (const chunk of streamChat(env, meter, messages, SYSTEM, '', MAX_TOKENS)) {
      if (chunk.type === 'content' && chunk.content) text += chunk.content;
      else if (chunk.type === 'error') return out.trim() || null;
      else if (chunk.type === 'done') truncated = !!chunk.truncated;
    }
    out += (round ? '\n' : '') + text;
    if (!truncated) break;
  }
  return out.trim() || null;
}

/** Markdown for a PDF or images, or null when no model is configured, it is too big, or the calls fail. */
export async function transcribeDocument(env: Env, meter: AiMeter, parts: ChatImage[]): Promise<string | null> {
  const todo = parts.filter((p) => p.data.length <= MAX_BASE64_CHARS).slice(0, MAX_IMAGES);
  if (!todo.length || !getAIProvider(env)) return null;
  const outs: string[] = [];
  for (const p of todo) {
    try {
      const t = await transcribeOne(env, meter, p);
      if (t) outs.push(t);
    } catch { /* one unreadable part never sinks the rest */ }
  }
  return outs.join('\n\n') || null;
}

export function transcribePdf(env: Env, meter: AiMeter, base64: string): Promise<string | null> {
  return transcribeDocument(env, meter, [{ mediaType: 'application/pdf', data: base64 }]);
}
