/**
 * Classify wrangler `r2 bucket create` stdout/stderr.
 * Shared by provision-cloudflare.mjs and its unit test.
 */
export function classifyR2Create(out) {
  if (/Created bucket/i.test(out)) return 'created';
  // "already exists" variants differ by wrangler version — non-fatal but loud.
  if (/already exists|Bucket already|403|409/i.test(out) || /exist/i.test(out)) return 'exists';
  if (!/ERROR|✘/.test(out)) return 'created';
  return 'error';
}
