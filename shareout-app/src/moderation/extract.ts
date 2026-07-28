// Static extraction from artifact HTML for the publish-time safety check
// (Workstream B). Regex-based (no DOM in the Worker hot path). The classifier
// can't see runtime behavior, so we surface the signals that most often hide it:
// external scripts, iframes, outbound URLs, and obfuscated inline JS.

export interface ExtractedSignals {
  externalScripts: string[];
  externalStyles: string[];
  iframes: string[];
  urls: string[];
  inlineScriptChars: number;
  obfuscationScore: number; // 0..1 heuristic; higher = more likely hand-obfuscated
}

const ABS_URL = /https?:\/\/[^\s"'`)<>]+/gi;
const SCRIPT_SRC = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const IFRAME_SRC = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const LINK_TAG = /<link\b[^>]*>/gi;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

// Tokens that commonly appear in payload-decoding / dynamic-eval obfuscation.
const OBFUSCATION_TOKENS = [
  'eval(', 'atob(', 'fromcharcode', 'unescape(', 'document.write(',
  '\\x', '\\u00', 'function(p,a,c,k,e', 'settimeout(atob',
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function matchAll(re: RegExp, s: string, group: number): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(s)) !== null) {
    const v = m[group];
    if (v) out.push(v);
  }
  return out;
}

/**
 * Rough 0..1 obfuscation score from inline JS.
 * Token hits (eval/atob/…) are required — length/minification alone is not enough.
 * Legit data apps often ship multi-MB inline JSON or minified chart helpers; those
 * used to false-positive to "suspicious" and force public publishes private.
 */
function scoreObfuscation(js: string): number {
  if (!js) return 0;
  const lower = js.toLowerCase();
  let tokenScore = 0;
  for (const tok of OBFUSCATION_TOKENS) {
    if (lower.includes(tok)) tokenScore += 0.18;
  }
  // No payload-decoding tokens → treat as ordinary (minified) code or data.
  if (tokenScore === 0) return 0;

  let score = tokenScore;
  const longestLine = js.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
  if (longestLine > 2000) score += 0.3;
  const nonWord = (js.match(/[^\w\s]/g)?.length ?? 0) / js.length;
  if (js.length > 200 && nonWord > 0.28) score += 0.3;
  return Math.min(1, score);
}

/** Hosts of external stylesheet <link rel="stylesheet" href="https://…"> tags. */
function externalStylesheetHosts(html: string): string[] {
  const out: string[] = [];
  LINK_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_TAG.exec(html)) !== null) {
    const tag = m[0];
    if (!/\brel\s*=\s*["'][^"']*stylesheet/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href && /^https?:/i.test(href)) {
      const h = hostOf(href);
      if (h) out.push(h);
    }
  }
  return uniq(out);
}

export function extractSignals(html: string): ExtractedSignals {
  const externalScripts = uniq(
    matchAll(SCRIPT_SRC, html, 1).map(hostOf).filter((h): h is string => !!h)
  );
  const externalStyles = externalStylesheetHosts(html);
  const iframes = uniq(
    matchAll(IFRAME_SRC, html, 1)
      .filter((s) => /^https?:/i.test(s))
      .map(hostOf)
      .filter((h): h is string => !!h)
  );
  const urls = uniq(
    (html.match(ABS_URL) ?? []).map(hostOf).filter((h): h is string => !!h)
  ).slice(0, 50);

  const inlineScripts = matchAll(INLINE_SCRIPT, html, 1);
  const inlineJoined = inlineScripts.join('\n');
  const obfuscationScore = inlineScripts.reduce((m, s) => Math.max(m, scoreObfuscation(s)), 0);

  return {
    externalScripts,
    externalStyles,
    iframes,
    urls,
    inlineScriptChars: inlineJoined.length,
    obfuscationScore,
  };
}

/** Outbound hosts worth submitting to a URL-reputation scanner. */
export function outboundHosts(signals: ExtractedSignals): string[] {
  return uniq([...signals.externalScripts, ...signals.iframes, ...signals.urls]);
}
