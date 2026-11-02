// What a code holder sees: the page in a locked-down frame under a watermark with their
// name, gone when the code's time is up — no countdown, no toolbar, nothing to save.
//
// None of this stops a screenshot or a photo of the screen; nothing in a browser can.
// It makes copying, saving and printing fail, names the person on every capture, keeps
// the exposure to the code's window, and reports what the viewer tried.
import type { Env } from '../../types';
import { createAccessToken } from '../../token';
import { artifactContentHost, artifactContentUrl, getSecurityHeaders } from '../../serve/security';
import { escapeHtml, NOINDEX_ROBOTS } from '../../serve/utils';
import { viewCodeGoneCopy } from '../../auth/pages';
import { pageLocale } from '../../i18n/accept-language';
import type { LiveViewCode } from './store';
import { VIEW_CODE_EVENT_KINDS } from './store';

import { VIEW_CONTENT_AUTH } from './tokens';

export { VIEW_CONTENT_AUTH };

// No same-origin, popups, modals or downloads: the frame can run the page and nothing else.
export const VIEW_SANDBOX = 'allow-scripts allow-forms';

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** The wrapper page for a code holder. */
export async function serveOneTimeViewer(
  request: Request,
  env: Env,
  opts: { slug: string; artifactId: string; entrypoint: string; live: LiveViewCode },
): Promise<Response> {
  const { slug, artifactId, entrypoint, live } = opts;
  const remainingMs = Math.max(0, live.closesAt - Date.now());
  const contentHost = artifactContentHost(env, artifactId, request);
  // The frame's token dies with the window, so its URL is worthless once the page closes.
  const ct = contentHost
    ? await createAccessToken(artifactId, VIEW_CONTENT_AUTH, env, Math.max(1, Math.ceil(remainingMs / 1000)))
    : undefined;
  const src = artifactContentUrl(env, artifactId, slug, entrypoint, ct, request);
  const lang = pageLocale(request);
  const gone = viewCodeGoneCopy(lang);
  const cfg = {
    aid: artifactId,
    ms: remainingMs,
    label: live.label,
    openedAt: live.openedAt,
    endpoint: '/auth/view-code/event',
    kinds: VIEW_CODE_EVENT_KINDS,
  };

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${NOINDEX_ROBOTS}">
<meta name="referrer" content="no-referrer">
<title>ShareOut</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;background:#fff}
*{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#so-otv-frame{position:fixed;inset:0;width:100%;height:100%;border:0;transition:filter .12s}
body.so-otv-blur #so-otv-frame{filter:blur(32px)}
#so-otv-mark{position:fixed;inset:0;pointer-events:none;z-index:2147483646;opacity:.2}
#so-otv-mark svg{display:block}
#so-otv-gone{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2328;text-align:center}
#so-otv-gone[hidden]{display:none}
#so-otv-gone h1{font-size:20px;margin:0 0 8px}
#so-otv-gone p{margin:0;color:#57606a}
@media print{html,body{display:none!important}}
</style>
<noscript><style>#so-otv-frame{display:none}</style></noscript>
</head>
<body>
<iframe id="so-otv-frame" src="${escapeHtml(src)}" sandbox="${VIEW_SANDBOX}" referrerpolicy="no-referrer" title="ShareOut"></iframe>
<div id="so-otv-mark" aria-hidden="true"></div>
<div id="so-otv-gone" hidden><div><h1>${escapeHtml(gone.title)}</h1><p>${escapeHtml(gone.body)}</p></div></div>
<script>${viewerScript(json(cfg))}</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, must-revalidate',
      ...getSecurityHeaders(false, env),
      // Not framable even by the Studio: a code holder's view lives in its own tab only.
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), display-capture=()',
      'X-Robots-Tag': NOINDEX_ROBOTS,
      'Referrer-Policy': 'no-referrer',
    },
  });
}

// Parent-frame script: watermark, the silent close, blur when the page loses the screen,
// and the attempt log. Same handlers the frame's guard posts to (VIEW_GUARD below).
function viewerScript(cfgJson: string): string {
  return `(function(){
var C=${cfgJson};
var frame=document.getElementById('so-otv-frame'),mark=document.getElementById('so-otv-mark'),gone=document.getElementById('so-otv-gone');
var t0=performance.now(),wallEnd=Date.now()+C.ms,closed=false,last={};
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return'&#'+c.charCodeAt(0)+';'})}
var d=new Date(C.openedAt),stamp=C.label;
try{stamp+=' \\u00b7 '+d.toLocaleDateString()+' '+d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}catch(e){}
// One full-screen SVG whose pattern is rotated as a whole, so no copy of the name is ever
// cut by a tile edge. Rows alternate by half a tile (brick), every 72px: no strip of the
// screen is free of the name.
var px=Math.ceil(stamp.length*8.4),W=px+64,R=72;
function t(x,y){return '<text x="'+(x+1)+'" y="'+(y+1)+'" fill="#fff">'+esc(stamp)+'</text><text x="'+x+'" y="'+y+'" fill="#000">'+esc(stamp)+'</text>'}
mark.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><defs><pattern id="so-otv-p" patternUnits="userSpaceOnUse" width="'+W+'" height="'+(2*R)+'" patternTransform="rotate(-24)">'+
'<g font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="15">'+t(0,R*0.6)+t(W/2,R*1.6)+t(-W/2,R*1.6)+'</g></pattern></defs>'+
'<rect width="100%" height="100%" fill="url(#so-otv-p)"/></svg>';
function report(k){if(closed||C.kinds.indexOf(k)<0)return;var n=Date.now();if(last[k]&&n-last[k]<3000)return;last[k]=n;
var b=JSON.stringify({artifact_id:C.aid,kind:k});
try{if(navigator.sendBeacon&&navigator.sendBeacon(C.endpoint,new Blob([b],{type:'text/plain'})))return}catch(e){}
try{fetch(C.endpoint,{method:'POST',body:b,credentials:'same-origin',keepalive:true})}catch(e){}}
function blurOn(){if(!closed)document.body.classList.add('so-otv-blur')}
function blurOff(){document.body.classList.remove('so-otv-blur')}
function close(){if(closed)return;closed=true;try{frame.src='about:blank'}catch(e){}frame.remove();mark.remove();blurOff();gone.hidden=false}
function overdue(){return performance.now()-t0>=C.ms||Date.now()>=wallEnd}
setTimeout(close,C.ms);
setInterval(function(){if(overdue())close()},1000);
function lostFocus(){setTimeout(function(){if(!document.hasFocus()){blurOn();report('left_page')}},0)}
document.addEventListener('visibilitychange',function(){if(overdue())return close();if(document.hidden){blurOn();report('left_page')}else blurOff()});
window.addEventListener('pageshow',function(){if(overdue())close()});
window.addEventListener('blur',lostFocus);
window.addEventListener('focus',blurOff);
function keys(e){var k=(e.key||'').toLowerCase(),m=e.ctrlKey||e.metaKey;
if(k==='printscreen'){report('screenshot_key');return}
if(m&&e.shiftKey&&(k==='3'||k==='4'||k==='5'||k==='s')){report('screenshot_key');return}
if(m&&k==='p'){e.preventDefault();report('print')}
else if(m&&k==='s'){e.preventDefault();report('save')}
else if(m&&(k==='c'||k==='x')){e.preventDefault();report('copy')}}
document.addEventListener('keydown',keys,true);
document.addEventListener('keyup',function(e){if(e.key==='PrintScreen')report('screenshot_key')},true);
document.addEventListener('contextmenu',function(e){e.preventDefault();report('context_menu')},true);
document.addEventListener('copy',function(e){e.preventDefault();report('copy')},true);
document.addEventListener('cut',function(e){e.preventDefault();report('copy')},true);
document.addEventListener('dragstart',function(e){e.preventDefault()},true);
window.addEventListener('beforeprint',function(){report('print')});
window.addEventListener('message',function(e){if(e.source!==frame.contentWindow)return;var m=e.data;if(!m||m.type!=='shareout:otv')return;
if(m.kind==='focus')return blurOff();if(m.kind==='blur')return lostFocus();report(m.kind)});
})();`;
}

// Injected into the page's own HTML when a code holder's frame loads it: no selection,
// copy, right-click, drag or print inside the page, and every attempt posted to the
// wrapper above, which logs it.
const VIEW_GUARD = `<style id="so-otv-guard">*,*::before,*::after{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}input,textarea,[contenteditable]{-webkit-user-select:text!important;user-select:text!important}img,svg,video,canvas{-webkit-user-drag:none!important}@media print{html,body{display:none!important}}</style>
<script>(function(){function s(k){try{parent.postMessage({type:'shareout:otv',kind:k},'*')}catch(e){}}
function f(e){var t=e.target;return t&&t.closest&&t.closest('input,textarea,[contenteditable]')}
function stop(k){return function(e){if(f(e))return;e.preventDefault();s(k)}}
document.addEventListener('copy',stop('copy'),true);document.addEventListener('cut',stop('copy'),true);
document.addEventListener('contextmenu',stop('context_menu'),true);
document.addEventListener('dragstart',function(e){e.preventDefault()},true);
document.addEventListener('selectstart',function(e){if(!f(e))e.preventDefault()},true);
document.addEventListener('keydown',function(e){var k=(e.key||'').toLowerCase(),m=e.ctrlKey||e.metaKey;
if(k==='printscreen')return s('screenshot_key');if(m&&e.shiftKey&&(k==='3'||k==='4'||k==='5'||k==='s'))return s('screenshot_key');
if(m&&k==='p'){e.preventDefault();s('print')}else if(m&&k==='s'){e.preventDefault();s('save')}else if(m&&(k==='c'||k==='x')&&!f(e)){e.preventDefault();s('copy')}},true);
document.addEventListener('keyup',function(e){if(e.key==='PrintScreen')s('screenshot_key')},true);
addEventListener('beforeprint',function(){s('print')});addEventListener('blur',function(){s('blur')});addEventListener('focus',function(){s('focus')});
})();</script>`;

/** Put the guard first in <head> (or <body> when the page has no head). */
export function injectViewGuard(resp: Response): Response {
  let done = false;
  const put = { element(e: { prepend: (c: string, o: { html: boolean }) => void }) {
    if (done) return;
    done = true;
    e.prepend(VIEW_GUARD, { html: true });
  } };
  return new HTMLRewriter().on('head', put).on('body', put).transform(resp);
}

/** A code holder's frame request that is a top-level visit — the frame's URL opened in a
 *  tab of its own, outside the wrapper's watermark and close. Browsers without
 *  Sec-Fetch-Dest (pre-2023 Safari) are let through. */
export function isTopLevelVisit(request: Request): boolean {
  return request.headers.get('Sec-Fetch-Dest') === 'document';
}
