// Multi-page artifacts. Injected into every served artifact HTML page (the document
// inside the sandboxed content frame). It does two things:
//
// 1. Link normalization. An absolute `/a/<slug>/…` or `https://<platform>/a/<slug>/…`
//    link to THIS artifact would load a whole viewer wrapper inside the content frame
//    (nested toolbar + skeleton). On click it navigates to the same page relative to
//    the content root instead, so the frame stays on the content domain and keeps the
//    `/c/<ct>/` capability prefix. A link to ANOTHER artifact never loads inside the
//    frame: in the /home shell it asks the wrapper to open an artifact tab, otherwise
//    it opens a new top-level tab. Relative links and modified clicks (new tab etc.)
//    are left to the browser. Click-time handling also covers JS-rendered nav menus.
// 2. Page awareness. On every page show it tells the wrapper which file is shown, so
//    the viewer/shell URL can reflect the sub-page (deep links, back/forward).
// 3. Section deep links. The viewer opens `?section=<anchor>` as the frame's #fragment.
//    A real id wins (the browser already jumped there); an `h-` anchor is a heading
//    without an id, found by the same text slug the corpus chunker gave it
//    (heading-anchors.ts). The target is scrolled to and briefly highlighted.
// 4. Error reports. Uncaught errors (a SyntaxError in a later <script> included — the
//    agent sits at the end of <head>, before the page's own scripts) and unhandled
//    promise rejections are posted to the wrapper, which tells the viewer something
//    broke and lets them report it (sandbox-viewer/error-bar.ts). URLs are cut to their
//    path minus the `/c/<capability>` prefix so a report never carries the token.
//    Deduped, at most 5 per page; opaque "Script error." and the benign ResizeObserver
//    loop warning are skipped.
//
// The constants are per (artifact, version, path) — the raw HTML edge cache key is the
// r2_key, which already encodes all three — so the cached body stays correct. Changing
// the agent itself: bump PAGE_AGENT_REV, which rides the cache variant.
import { headingAnchors } from './heading-anchors';

/** Revision of the injected agent; part of the raw-HTML cache variant so edits reach cached pages. */
export const PAGE_AGENT_REV = '2';

export function buildPageAgent(slug: string, baseOrigin: string, pagePath: string, entrypoint: string): string {
  const j = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c');
  return `(function(){try{
if(window.parent===window)return;
var S=${j(slug)},B=${j(baseOrigin)},P=${j(pagePath)},E=${j(entrypoint)},shell=false;
function post(m){try{parent.postMessage(m,'*');}catch(e){}}
var nE=0,seenE={};
function cut(s,n){s=s==null?'':String(s);s=s.replace(/https?:\\/\\/[^\\s)'"]*/g,function(u){return u.replace(/^https?:\\/\\/[^\\/]+/,'').replace(/^\\/c\\/[^\\/]+/,'');});return s.length>n?s.slice(0,n)+'...':s;}
function oops(kind,msg,where,stack){msg=cut(msg,500);
if(!msg||/^Script error\\.?$/.test(msg)||/ResizeObserver loop/.test(msg))return;
var k=kind+'|'+msg+'|'+where;if(seenE[k]||nE>=5)return;seenE[k]=1;nE++;
post({type:'shareout:error',kind:kind,message:msg,where:cut(where,300),stack:cut(stack,2000),path:P});}
addEventListener('error',function(e){if(!e||typeof e.message!=='string')return;
oops('error',e.message,(e.filename||'')+(e.lineno?':'+e.lineno+':'+(e.colno||0):''),e.error&&e.error.stack);});
addEventListener('unhandledrejection',function(e){var r=e&&e.reason,m;
if(r&&typeof r.message==='string')m=r.message;else if(typeof r==='string')m=r;else{try{m=JSON.stringify(r);}catch(x){m=String(r);}}
oops('rejection',m,'',r&&r.stack);});
addEventListener('pageshow',function(){post({type:'shareout:page',path:P});});
addEventListener('message',function(e){if(e.source===parent&&e.data&&e.data.type==='shareout:shell')shell=true;});
function root(){var p=location.pathname,d;try{d=decodeURI(p);}catch(e){d=p;}
if(d.length>=P.length&&d.slice(d.length-P.length)===P)return p.slice(0,p.length-encodeURI(P).length);
return p.slice(0,p.lastIndexOf('/')+1);}
function parse(h){if(!h||!/^(\\/(?!\\/)|https?:\\/\\/)/i.test(h))return null;var u;try{u=new URL(h,location.href);}catch(e){return null;}
if(u.origin!==location.origin&&u.origin!==B)return null;
var m=/^\\/a\\/([^\\/]+)(?:\\/(.*))?$/.exec(u.pathname);if(!m)return null;
var s;try{s=decodeURIComponent(m[1]);}catch(e){return null;}
return{slug:s,rest:m[2]||'',tail:u.search+u.hash};}
document.addEventListener('click',function(e){
if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a||a.hasAttribute('download'))return;
var t=parse(a.getAttribute('href'));if(!t)return;
var tg=(a.getAttribute('target')||'').toLowerCase();
if(t.slug===S){if(tg&&tg!=='_self')return;e.preventDefault();
location.href=root()+(t.rest||(location.origin===B?E:''))+t.tail;return;}
e.preventDefault();
if(shell){var r=t.rest;try{r=decodeURIComponent(r);}catch(x){}post({type:'shareout:open-artifact',slug:t.slug,path:r});return;}
window.open(B+'/a/'+encodeURIComponent(t.slug)+'/'+t.rest+t.tail,'_blank','noopener');
});
var A=${headingAnchors.toString()},cur=null;
function target(h){var el=document.getElementById(h);if(el||!/^h-/.test(h))return el;
var hs=document.querySelectorAll('h1,h2,h3,h4,h5,h6'),tx=[],i;for(i=0;i<hs.length;i++)tx.push(hs[i].textContent||'');
var sl=A(tx),c=h.replace(/-/g,'');for(i=0;i<sl.length;i++)if(sl[i]===h)return hs[i];
for(i=0;i<sl.length;i++)if(sl[i]&&sl[i].replace(/-/g,'')===c)return hs[i];return null;}
function flash(el){var s=el.style,o=s.outline,oo=s.outlineOffset,b=s.backgroundColor,tr=s.transition;
s.transition='outline-color .8s,background-color .8s';s.outline='3px solid rgba(250,204,21,.9)';s.outlineOffset='4px';s.backgroundColor='rgba(250,204,21,.18)';
setTimeout(function(){s.outline=o;s.outlineOffset=oo;s.backgroundColor=b;setTimeout(function(){s.transition=tr;},900);},2200);}
function go(first){var h=(location.hash||'').slice(1);try{h=decodeURIComponent(h);}catch(e){return;}
if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(h)||(!first&&!/^h-/.test(h)))return;
var el=target(h);if(!el)return;cur=el;try{el.scrollIntoView({block:'start'});}catch(e){}flash(el);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){go(true);});else if(document.readyState)go(true);
addEventListener('hashchange',function(){go(false);});
addEventListener('load',function(){if(cur)try{cur.scrollIntoView({block:'start'});}catch(e){}});
}catch(e){}})();`;
}

export function injectPageAgent(
  resp: Response,
  ctx: { slug: string; baseUrl: string; pagePath: string; entrypoint: string },
): Response {
  let origin = ctx.baseUrl;
  try { origin = new URL(ctx.baseUrl).origin; } catch { /* keep as configured */ }
  const tag = `<script>${buildPageAgent(ctx.slug, origin, ctx.pagePath, ctx.entrypoint)}</script>`;
  let injected = false;
  const append = {
    element(e: { append: (c: string, o: { html: boolean }) => void }) {
      if (injected) return;
      injected = true;
      e.append(tag, { html: true });
    },
  };
  return new HTMLRewriter().on('head', append).on('body', append).transform(resp);
}

// Paths a viewer may open as its first page (`?page=`): a plain relative file path,
// no traversal, no query/fragment/encoding tricks. Existence + text/html is checked
// against the version's assets by the caller.
export function isSafePagePath(p: string): boolean {
  if (!p || p.length > 512 || p.startsWith('/')) return false;
  if (!/^[A-Za-z0-9._~\-/ ]+$/.test(p)) return false;
  return !p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
}

// Heading ids a deep link may scroll to (`?section=`): plain id characters only.
export function isSafeSectionId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(id);
}

// Wrapper side of the page bridge (the viewer around the content frame). Relays the
// content frame's page reports and cross-artifact link requests. In the /home shell
// (`?wsx=1`) it forwards both to the shell; standalone it mirrors the sub-page into
// the viewer URL (`?page=`) so a reload or a copied link lands on the same page.
// Only the content frame's own window is trusted as a source, and an open-artifact
// request is only honored during a user gesture (the click activates ancestors too).
// Error reports from the frame are queued on `window.__soErrors` (this bridge streams
// before the error bar exists — a broken page errors right away) and announced with a
// `shareout:error` event the error bar listens for.
export function renderPageBridge(slug: string, entrypoint: string, inShell: boolean): string {
  const j = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c');
  return `<script>(function(){
var S=${j(slug)},E=${j(entrypoint)},shell=${inShell ? 'true' : 'false'}&&window.parent!==window;
var errs=window.__soErrors=window.__soErrors||[];
function str(v,n){return typeof v==='string'?v.slice(0,n):'';}
addEventListener('message',function(e){
var f=document.querySelector('iframe');if(!f||e.source!==f.contentWindow)return;
var d=e.data;if(!d||typeof d.type!=='string')return;
if(d.type==='shareout:error'&&typeof d.message==='string'&&d.message){
if(errs.length>=5)return;
errs.push({kind:d.kind==='rejection'?'rejection':'error',message:str(d.message,500),where:str(d.where,300),stack:str(d.stack,2000),path:str(d.path,512)});
try{dispatchEvent(new Event('shareout:error'));}catch(x){}
}else if(d.type==='shareout:page'&&typeof d.path==='string'&&d.path.length<=512){
var pg=d.path===E?'':d.path;
if(shell){try{f.contentWindow.postMessage({type:'shareout:shell'},'*');}catch(x){}
window.parent.postMessage({type:'shareout:page',slug:S,page:pg},location.origin);return;}
try{var u=new URL(location.href);if(pg)u.searchParams.set('page',pg);else u.searchParams.delete('page');
if(u.href!==location.href)history.replaceState(history.state,'',u.href);}catch(x){}
}else if(shell&&d.type==='shareout:open-artifact'&&typeof d.slug==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(d.slug)){
if(navigator.userActivation&&!navigator.userActivation.isActive)return;
var p=typeof d.path==='string'&&d.path.length<=512?d.path:'';
window.parent.postMessage({type:'shareout:open-artifact',slug:d.slug,page:p},location.origin);
}
});
})();</script>`;
}
