// "Made with ShareOut" badge (Workstream C). Injected into the raw artifact HTML
// (iframe document) for public artifacts when the instance opts in with
// ARTIFACT_BADGE=1 — off by default. It used to be forced on for the free tier,
// which on a self-hosted instance meant every public page carried an unremovable
// watermark linking to someone else's product. Folds in a "Report" link
// (Workstream D) so a badged public page carries an abuse path.
//
// Inline <style>+<div> only: no script, no external assets, so it survives the
// opaque-origin sandbox and needs no CSP change (style-src 'unsafe-inline' is
// already allowed).

import type { Env } from '../types';
import { colors } from '../../packages/design-tokens/src/index';

function buildBadge(homeUrl: string, reportUrl: string): string {
  return `<style>
.so-badge{position:fixed;right:12px;bottom:12px;z-index:2147483600;display:flex;align-items:center;gap:2px;
font:500 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:${colors.bgElevated};color:${colors.text};padding:0 6px;border-radius:9999px;
border:1px solid ${colors.border};box-shadow:0 1px 4px rgba(0,0,0,.12);max-width:calc(100vw - 24px)}
.so-badge a{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 6px;color:inherit;text-decoration:none;white-space:nowrap}
.so-badge a:focus-visible{outline:2px solid ${colors.primary};outline-offset:-2px;border-radius:9999px}
.so-badge .so-dot{color:${colors.primary}}
.so-badge .so-report{color:${colors.textSecondary};font-size:11px}
@media(max-width:480px){.so-badge{right:8px;bottom:8px}.so-badge .so-long{display:none}}
@media(min-width:481px){.so-badge .so-short{display:none}}
</style>
<div class="so-badge" role="contentinfo">
<a href="${homeUrl}" target="_blank" rel="noopener" aria-label="Made with ShareOut"><span class="so-dot" aria-hidden="true">&hearts;</span><span class="so-long">Made with ShareOut</span><span class="so-short">ShareOut</span></a>
<a class="so-report" href="${reportUrl}" target="_blank" rel="noopener">Report</a>
</div>`;
}

/** True when the instance opts into badging its public artifacts. Off by default. */
export function badgeEnabled(env: Env): boolean {
  return env.ARTIFACT_BADGE === '1';
}

/** Append the badge into the served artifact's <body>. baseUrl is the trusted API
 *  origin; artifactId targets the abuse-report endpoint (Workstream D). */
export function injectBadge(resp: Response, artifactId: string, baseUrl: string): Response {
  const tag = buildBadge(baseUrl, `${baseUrl}/report/${artifactId}`);
  let injected = false;
  return new HTMLRewriter()
    .on('body', {
      element(e: { append: (c: string, o: { html: boolean }) => void }) {
        if (injected) return;
        injected = true;
        e.append(tag, { html: true });
      },
    })
    .transform(resp);
}
