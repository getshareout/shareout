/**
 * Provider-neutral context management for the agent engine: keeping a long tool-using
 * transcript small enough to resend on every call when the route has no server-side
 * context editing (everything but direct Anthropic).
 */
import type { NeutralTurn } from '../crew/provider';

export interface TrimOptions {
  /** Assistant turns (with their tool results) left untouched at the end. */
  keepRecent: number;
  /** Trim only once the transcript is at least this many characters. */
  atChars: number;
}

export const DEFAULT_TRIM: TrimOptions = { keepRecent: 8, atChars: 120_000 };

/** Characters a turn costs to resend (text, tool inputs, tool results). */
export function turnChars(turn: NeutralTurn): number {
  return turn.role === 'user' ? turn.text.length
    : turn.role === 'assistant' ? turn.text.length + JSON.stringify(turn.toolCalls).length
      : turn.results.reduce((n, r) => n + r.content.length, 0);
}

/** A rough token count (≈4 characters a token): enough to decide when to trim or summarize. */
export const estimateTokens = (chars: number): number => Math.ceil(chars / 4);

/**
 * Stand-in for the Anthropic harness's context editing: once the transcript is big, older
 * file contents, edit pairs and tool results are replaced by a stub (the model can read
 * them again). The first message and the newest turns stay as they are.
 */
export function trimTranscript(transcript: NeutralTurn[], opts: TrimOptions = DEFAULT_TRIM): NeutralTurn[] {
  if (transcript.reduce((n, turn) => n + turnChars(turn), 0) < opts.atChars) return transcript;
  const assistantIdx = transcript.flatMap((turn, i) => (turn.role === 'assistant' ? [i] : []));
  const cut = assistantIdx[assistantIdx.length - opts.keepRecent];
  if (cut === undefined) return transcript;
  return transcript.map((turn, i) => {
    if (i === 0 || i >= cut) return turn;
    if (turn.role === 'assistant') {
      return {
        ...turn,
        toolCalls: turn.toolCalls.map((tc) =>
          typeof tc.input.content === 'string' && tc.input.content.length > 300
            ? { ...tc, input: { ...tc.input, content: `[${tc.input.content.length} chars written; read_file to see them]` } }
            : typeof tc.input.old === 'string' && tc.input.old.length + String(tc.input.new ?? '').length > 600
              ? { ...tc, input: { ...tc.input, old: '[trimmed]', new: '[trimmed]' } }
              : tc),
      };
    }
    if (turn.role === 'tool') return { ...turn, results: turn.results.map((r) => (r.content.length > 200 ? { ...r, content: `${r.content.slice(0, 120)}… [trimmed]` } : r)) };
    return turn;
  });
}
