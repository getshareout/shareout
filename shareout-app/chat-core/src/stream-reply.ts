/**
 * Some ShareOut agents stream a JSON object (`{"reply": "...", "changes": {...}}`)
 * token by token. To show the user prose instead of raw JSON while it streams,
 * extract the `reply` string value from the partial JSON as it grows.
 *
 * Returns null until the reply value has started, then the best-effort decoded prose
 * so far. Handles standard JSON string escapes and stops cleanly on an incomplete tail.
 */
export function extractStreamingReply(raw: string): string | null {
  const keyIdx = raw.indexOf('"reply"');
  if (keyIdx === -1) return null;

  let i = raw.indexOf(':', keyIdx);
  if (i === -1) return null;
  i++;
  while (i < raw.length && (raw[i] === ' ' || raw[i] === '\n' || raw[i] === '\t' || raw[i] === '\r')) i++;
  if (raw[i] !== '"') return null;
  i++; // past the opening quote

  let out = '';
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\') {
      const next = raw[i + 1];
      if (next === undefined) break; // incomplete escape at the stream tail
      switch (next) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'u': {
          const hex = raw.slice(i + 2, i + 6);
          if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          }
          return out; // incomplete \u escape — show what we have
        }
        default: out += next; break;
      }
      i += 2;
      continue;
    }
    if (ch === '"') break; // closing quote → reply value complete
    out += ch;
    i++;
  }
  return out;
}
