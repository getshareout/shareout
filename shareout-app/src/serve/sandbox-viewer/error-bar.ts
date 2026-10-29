/**
 * The viewer's error bar. When the page inside the frame throws (a script that never
 * parsed, an uncaught error, a rejected promise — reported by the page agent, queued by
 * the page bridge on `window.__soErrors`), the viewer is told something broke instead
 * of clicking dead buttons, can read what failed, and — signed in — can send it to
 * support as a ticket (POST /v1/support/tickets) with the page, version and errors
 * attached. Not a modal: one dismissable bar at the top. Design tokens only.
 */
import type { Locale, LocaleCopy } from '../../i18n';
import { cssVariables } from '../../design-system/base.css';

const en = {
  title: 'Something went wrong on this page, so parts of it may not work.',
  showDetail: 'Show details',
  hideDetail: 'Hide details',
  report: 'Report to support',
  sending: 'Sending…',
  sent: 'Reported as {id}. We will reply by email.',
  failed: 'Could not send the report. Try again.',
  signIn: 'Sign in to report it, or tell whoever shared this page with you.',
  dismiss: 'Dismiss',
  subject: 'Page error: {name}',
  intro: 'Reported from the page viewer.',
};

const es: typeof en = {
  title: 'Algo falló en esta página y puede que no funcione bien.',
  showDetail: 'Ver detalle',
  hideDetail: 'Ocultar detalle',
  report: 'Reportar a soporte',
  sending: 'Enviando…',
  sent: 'Reportado como {id}. Te respondemos por mail.',
  failed: 'No se pudo enviar el reporte. Probá de nuevo.',
  signIn: 'Iniciá sesión para reportarlo, o avisale a quien te compartió esta página.',
  dismiss: 'Cerrar',
  subject: 'Error en la página: {name}',
  intro: 'Reportado desde el visor de la página.',
};

export const ERROR_BAR_COPY: LocaleCopy<typeof en> = { en, es };

export interface ErrorBarOptions {
  artifactId: string;
  versionId: string;
  workspaceId: string | null;
  slug: string;
  /** Trusted API origin the support ticket is posted to (session cookie, like the toolbar). */
  baseUrl: string;
  locale: Locale;
  /** A signed-in viewer can file a ticket; anyone else is told who to tell. */
  canReport: boolean;
  /** Ship the --color-* / --space-* tokens (nothing else on the page does). */
  withVars: boolean;
}

const styles = `
    #so-err { position: fixed; top: var(--space-4); left: 50%; transform: translateX(-50%); z-index: 10002;
      width: min(640px, calc(100vw - 2 * var(--space-4))); box-sizing: border-box;
      padding: var(--space-3) var(--space-4); border: 1px solid var(--color-border); border-left: 4px solid var(--color-error);
      border-radius: var(--radius-md); background: var(--color-bg-elevated); box-shadow: var(--shadow-lg);
      color: var(--color-text); font: 400 14px/1.45 var(--font-body); }
    #so-err[hidden] { display: none; }
    .so-err-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
    .so-err-title { flex: 1 1 260px; margin: 0; font-weight: 600; }
    .so-err-btn { min-height: 32px; padding: 0 var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-sm);
      background: var(--color-bg-elevated); color: var(--color-text); font: 500 13px/1 var(--font-body); cursor: pointer; }
    .so-err-btn:hover { border-color: var(--color-border-strong); }
    .so-err-btn.so-err-primary { border-color: var(--color-primary); background: var(--color-primary); color: var(--color-text-inverse); }
    .so-err-btn.so-err-primary:hover { background: var(--color-primary-hover); }
    .so-err-btn[disabled] { opacity: .6; cursor: default; }
    .so-err-x { width: 32px; height: 32px; padding: 0; border: 0; background: none; color: var(--color-text-secondary); font-size: 20px; line-height: 1; cursor: pointer; }
    .so-err-btn:focus-visible, .so-err-x:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .so-err-detail { max-height: 180px; overflow: auto; margin: var(--space-3) 0 0; padding: var(--space-3); border-radius: var(--radius-sm);
      background: var(--color-error-light); color: var(--color-text); font: 12px/1.5 var(--font-mono); white-space: pre-wrap; word-break: break-word; }
    .so-err-detail[hidden], .so-err-status:empty { display: none; }
    .so-err-status { margin: var(--space-2) 0 0; color: var(--color-text-secondary); }
`;

function script(o: ErrorBarOptions): string {
  const j = (v: unknown) => JSON.stringify(v ?? null).replace(/</g, '\\u003c');
  const c = ERROR_BAR_COPY[o.locale] ?? en;
  return `(function(){
var C=${j(c)},A=${j(o.artifactId)},V=${j(o.versionId)},W=${j(o.workspaceId)},S=${j(o.slug)},B=${j(o.baseUrl)},L=${j(o.locale)},canReport=${o.canReport ? 'true' : 'false'};
var bar=document.getElementById('so-err');if(!bar)return;
var detail=bar.querySelector('.so-err-detail'),status=bar.querySelector('.so-err-status'),
  more=bar.querySelector('[data-so-err="detail"]'),rep=bar.querySelector('[data-so-err="report"]'),dismissed=false,sent=null;
function errs(){return window.__soErrors||[];}
function frames(e){return e.stack&&e.stack.indexOf('\\n')>=0?'\\n'+e.stack:'';}
function line(e){return '['+e.kind+'] '+e.message+(e.where?'\\n  at '+e.where:'')+(e.path?'\\n  page '+e.path:'');}
function render(){var list=errs();if(!list.length||dismissed)return;
detail.textContent=list.map(function(e){return line(e)+frames(e);}).join('\\n\\n');
bar.hidden=false;}
function hash(s){var h=5381;for(var i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return (h>>>0).toString(36);}
function body(){var list=errs();
return [C.intro,'','Page: '+location.href,'Artifact: '+A+' · version '+V,'',
list.map(function(e){return line(e)+frames(e);}).join('\\n\\n'),'','Browser: '+navigator.userAgent].join('\\n');}
function post(ws){var first=errs()[0]||{message:''};
return fetch(B+'/v1/support/tickets',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
body:JSON.stringify({subject:C.subject.replace('{name}',document.title||S),body:body(),category:'bug',severity:'normal',client:'ui',
artifactId:A,pageUrl:location.href,userAgent:navigator.userAgent,locale:L,workspaceId:ws||undefined,
idempotencyKey:'page-error:'+A+':'+V+':'+hash(first.message)})});}
function say(t){status.textContent=t;}
if(!canReport){rep.hidden=true;say(C.signIn);}
more.addEventListener('click',function(){var open=detail.hidden;detail.hidden=!open;more.textContent=open?C.hideDetail:C.showDetail;more.setAttribute('aria-expanded',open?'true':'false');});
rep.addEventListener('click',function(){if(sent)return;rep.disabled=true;say(C.sending);
post(W).then(function(r){return r.status===403&&W?post(null):r;})
.then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
.then(function(d){sent=d&&d.ticket&&d.ticket.id||'';say(C.sent.replace('{id}',sent));rep.hidden=true;})
.catch(function(){rep.disabled=false;say(C.failed);});});
bar.querySelector('.so-err-x').addEventListener('click',function(){dismissed=true;bar.hidden=true;});
addEventListener('shareout:error',render);
render();
})();`;
}

export function renderErrorBar(o: ErrorBarOptions): string {
  const c = ERROR_BAR_COPY[o.locale] ?? en;
  const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `
  <style>${o.withVars ? cssVariables : ''}${styles}</style>
  <div id="so-err" role="alert" hidden>
    <div class="so-err-row">
      <p class="so-err-title">${attr(c.title)}</p>
      <button type="button" class="so-err-btn" data-so-err="detail" aria-expanded="false">${attr(c.showDetail)}</button>
      <button type="button" class="so-err-btn so-err-primary" data-so-err="report">${attr(c.report)}</button>
      <button type="button" class="so-err-x" aria-label="${attr(c.dismiss)}">×</button>
    </div>
    <pre class="so-err-detail" hidden></pre>
    <p class="so-err-status" aria-live="polite"></p>
  </div>
  <script>${script(o)}</script>`;
}
