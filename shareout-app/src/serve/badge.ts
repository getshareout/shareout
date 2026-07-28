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

function buildBadge(homeUrl: string, reportUrl: string): string {
  return `<style>
.so-badge{position:fixed;right:12px;bottom:12px;z-index:2147483600;display:flex;align-items:center;gap:6px;
font:500 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:rgba(255,255,255,.92);color:#1a1a2e;padding:6px 10px;border-radius:9999px;
box-shadow:0 1px 4px rgba(0,0,0,.18);text-decoration:none;backdrop-filter:saturate(1.2) blur(4px);
max-width:calc(100vw - 24px)}
.so-badge a{color:inherit;text-decoration:none}
.so-badge .so-dot{color:#e0245e}
.so-badge .so-sep{opacity:.35}
.so-badge .so-report{opacity:.6;font-size:11px}
@media(max-width:480px){.so-badge .so-label{display:none}.so-badge{padding:7px 9px}}
</style>
<div class="so-badge" role="contentinfo">
<a href="${homeUrl}" target="_blank" rel="noopener"><span class="so-dot">&hearts;</span> <span class="so-label">Made with ShareOut</span></a>
<span class="so-sep so-label">&middot;</span>
<a class="so-report so-label" href="${reportUrl}" target="_blank" rel="noopener">Report</a>
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
