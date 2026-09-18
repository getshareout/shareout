// Date tokens for scheduled query configs. SQL sources express a rolling window
// with CURRENT_DATE(); REST sources (Mixpanel and friends) take absolute
// YYYY-MM-DD arguments, so a fixed config would freeze on the day it was written.
//
//   {{today}}      {{yesterday}}      {{date:-7d}}      {{date:+1d}}

const TOKEN_RE = /\{\{\s*(today|yesterday|date:([+-]\d+)d)\s*\}\}/g;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Resolve date tokens in a string. Non-matching text is returned untouched. */
export function resolveDateTokens(input: string, now = new Date()): string {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return input.replace(TOKEN_RE, (_m, kind: string, offset?: string) => {
    if (kind === 'today') return isoDay(base);
    if (kind === 'yesterday') return isoDay(base - 86400000);
    return isoDay(base + Number(offset) * 86400000);
  });
}

/** Resolve date tokens in every string value of a params object (shallow). */
export function resolveDateTokensInParams(
  params: Record<string, unknown> | undefined,
  now = new Date()
): Record<string, unknown> | undefined {
  if (!params) return params;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === 'string' ? resolveDateTokens(v, now) : v;
  }
  return out;
}
