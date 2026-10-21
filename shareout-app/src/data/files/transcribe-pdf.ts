// A PDF with no text layer (a scan, a drawing) read by a vision model, page by page,
// into markdown. Last resort after Workers AI toMarkdown: costs a model call per file.
import type { Env } from '../../types';
import { chatComplete, getAIProvider } from '../agent/anthropic';

// The request body carries the PDF as base64; keep well under provider limits (~32MB).
const MAX_BASE64_CHARS = 27_000_000;

const SYSTEM = `You transcribe a scanned document into clean markdown.
- Copy every word as written, in its original language. Do not summarize, translate or add commentary.
- Keep structure: headings, numbered lists, and tables as markdown tables.
- For a stamp, signature or drawing, write a short bracketed note like [firma] or [diagrama].
- Output only the markdown.`;

/** Markdown for the PDF, or null when no model is configured, the file is too big, or the call fails. */
export async function transcribePdf(env: Env, base64: string): Promise<string | null> {
  if (base64.length > MAX_BASE64_CHARS || !getAIProvider(env)) return null;
  try {
    const out = await chatComplete(env, [{
      role: 'user',
      content: 'Transcribe this document.',
      image: { mediaType: 'application/pdf', data: base64 },
    }], SYSTEM, 16_000);
    return out.trim() || null;
  } catch {
    return null;
  }
}
