// Shared shell for every starter-kit artifact. Keeps all 15 examples visually
// consistent (warm stone palette, blue used sparingly — Design/brand) and gives
// each one a banner that names the feature it teaches and reminds the user the
// artifact is theirs to edit or delete. Authoring an example = supplying the
// inner body + script; the frame handles <head>, SDK load, banner, and base CSS.

import { colors, fonts, radius, shadows } from '../design-system/tokens';

interface FrameParts {
  /** <title> + banner heading. */
  title: string;
  /** Feature label for the banner pill, e.g. "so.table". */
  feature: string;
  /** One line under the heading. */
  description: string;
  /** Extra markup injected into <head> (per-artifact <style>, meta). Optional. */
  head?: string;
  /** Inner HTML placed inside the <main> content area. */
  body: string;
  /** Artifact JS, runs after the SDK loads. No surrounding <script> tag. */
  script: string;
}

const BASE_CSS = `
:root{
  --so-blue:${colors.primary};--so-blue-hover:${colors.primaryHover};--so-blue-light:${colors.primaryLight};
  --so-bg:${colors.bg};--so-surface:${colors.bgElevated};--so-border:${colors.border};
  --so-ink:${colors.text};--so-ink-2:${colors.textSecondary};--so-ink-3:${colors.textTertiary};
  --so-radius:${radius.lg};--so-shadow:${shadows.sm}, ${shadows.xl};
}
*{box-sizing:border-box}
body{margin:0;background:var(--so-bg);color:var(--so-ink);
  font-family:${fonts.body};
  line-height:1.5;-webkit-font-smoothing:antialiased}
.so-wrap{max-width:760px;margin:0 auto;padding:24px 20px 64px}
.so-banner{display:flex;gap:14px;align-items:flex-start;
  background:var(--so-surface);border:1px solid var(--so-border);border-radius:var(--so-radius);
  padding:16px 18px;margin-bottom:24px;box-shadow:var(--so-shadow)}
.so-banner .so-mark{flex:0 0 auto;width:34px;height:34px;border-radius:9px;
  background:var(--so-blue-light);color:var(--so-blue);display:grid;place-items:center;font-weight:700}
.so-banner h1{font-size:17px;margin:0 0 2px;font-weight:650;letter-spacing:-.01em}
.so-banner p{margin:0;color:var(--so-ink-2);font-size:13.5px}
.so-pill{display:inline-block;font-size:11px;font-weight:600;color:var(--so-blue);
  background:var(--so-blue-light);border-radius:999px;padding:2px 9px;margin-bottom:6px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.so-foot{margin-top:8px;font-size:12.5px;color:var(--so-ink-3)}
.so-foot a{color:var(--so-ink-2);text-decoration:none;border-bottom:1px solid var(--so-border)}
.so-card{background:var(--so-surface);border:1px solid var(--so-border);
  border-radius:var(--so-radius);padding:20px;box-shadow:var(--so-shadow)}
.so-btn{appearance:none;border:0;cursor:pointer;font:inherit;font-weight:600;
  background:var(--so-blue);color:${colors.textInverse};border-radius:10px;padding:10px 16px}
.so-btn:hover{background:var(--so-blue-hover)}
.so-card > .so-btn{margin-top:8px}
.so-btn.ghost{background:transparent;color:var(--so-ink);border:1px solid var(--so-border)}
.so-input{font:inherit;width:100%;padding:10px 12px;border:1px solid var(--so-border);
  border-radius:10px;background:var(--so-surface);color:var(--so-ink)}
.so-input:focus{outline:2px solid var(--so-blue-light);border-color:var(--so-blue)}
.so-muted{color:var(--so-ink-2);font-size:13px}
h2{font-size:15px;letter-spacing:-.01em;margin:0 0 12px}
`;

export function frame(parts: FrameParts): string {
  const { title, feature, description, head = '', body, script } = parts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<script src="https://shareout.site/sdk/shareout.js"></script>
<style>${BASE_CSS}</style>
${head}
</head>
<body>
<div class="so-wrap">
  <header class="so-banner">
    <div class="so-mark">✦</div>
    <div>
      <span class="so-pill">${feature}</span>
      <h1>${title}</h1>
      <p>${description}</p>
      <div class="so-foot">A ShareOut example — yours to edit or delete. <a href="https://shareout.site" target="_blank" rel="noopener">Build your own</a></div>
    </div>
  </header>
  <main>${body}</main>
</div>
<script>
(async function(){
  try{
    const so = new ShareOut();
    ${script}
  }catch(err){
    console.error('starter-kit example error', err);
  }
})();
</script>
</body>
</html>`;
}
