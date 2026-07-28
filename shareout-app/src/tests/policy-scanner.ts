// Artifact Tests — static policy scanner. Defense-in-depth signal #1 of N, NOT a
// guarantee. It deliberately can't catch obfuscated/encoded/runtime-loaded or
// data-resident secrets, XSS, or supply-chain via an allowlisted CDN. Results are
// ADVISORY: surfaced + alerted, but never used to hold a version (see runner's
// blocking decision). Never label output "safe" or "complies" — see specs.

import type { TestResult } from './types';

// Honest, bounded findings. High-confidence provider key formats only — a generic
// /secret/i regex is noise, so we match shapes that are almost certainly live keys.
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'Stripe-style key', re: /\b[sprk]k_(live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

// Hosts we treat as ordinary, expected dependencies. Anything else is flagged as
// INFO (not a failure) so the owner can eyeball where their artifact talks to.
const KNOWN_HOSTS = [
  'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com',
  'fonts.gstatic.com', 'esm.sh', 'cdn.tailwindcss.com', 'd3js.org', 'cdn.plot.ly',
];

const MAX_HTML_CHARS = 80_000;

function extractHosts(html: string): Set<string> {
  const hosts = new Set<string>();
  const urlRe = /(?:src|href)\s*=\s*["'](https?:\/\/[^"'\s]+)["']|fetch\(\s*["'](https?:\/\/[^"'\s]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(html)) !== null) {
    const raw = m[1] || m[2];
    try { hosts.add(new URL(raw).host.toLowerCase()); } catch { /* ignore */ }
  }
  return hosts;
}

/** Static scan of the entrypoint HTML. Returns advisory TestResult[] (tier 'policy').
 *  A 'failed' here means "worth a human look", not "unsafe" — copy must reflect that. */
export function scanPolicy(html: string): TestResult[] {
  const t0 = Date.now();
  const src = html.slice(0, MAX_HTML_CHARS);
  const results: TestResult[] = [];

  // 1. Secrets in source (high-confidence shapes only).
  const found: string[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(src)) found.push(name);
  }
  results.push({
    name: 'No obvious secrets in source',
    tier: 'policy',
    status: found.length ? 'failed' : 'passed',
    message: found.length
      ? `Possible ${found.join(', ')} in HTML. Move secrets server-side. (Can't catch encoded/runtime/data-resident secrets.)`
      : 'No high-confidence key patterns found in entrypoint HTML.',
    duration_ms: Date.now() - t0,
  });

  // 2. External hosts — informational map, never a failure.
  const hosts = [...extractHosts(src)];
  const unknown = hosts.filter((h) => !KNOWN_HOSTS.some((k) => h === k || h.endsWith('.' + k)));
  results.push({
    name: 'External hosts reviewed',
    tier: 'policy',
    status: 'passed',
    message: hosts.length
      ? `Talks to: ${hosts.join(', ')}.${unknown.length ? ` Unrecognised: ${unknown.join(', ')}.` : ''}`
      : 'No external hosts referenced in source.',
    duration_ms: Date.now() - t0,
  });

  // 3. CSP presence — informational.
  const hasCsp = /http-equiv\s*=\s*["']content-security-policy["']/i.test(src);
  results.push({
    name: 'Content-Security-Policy present',
    tier: 'policy',
    status: 'passed',
    message: hasCsp ? 'CSP meta tag found.' : 'No CSP meta tag (optional; adds defense-in-depth).',
    duration_ms: Date.now() - t0,
  });

  return results;
}
