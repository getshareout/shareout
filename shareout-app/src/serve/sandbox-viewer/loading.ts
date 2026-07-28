/**
 * Branded loading skeleton shown in the viewer wrapper while the sandboxed
 * artifact boots and fetches its data. Painted in the first streamed chunk
 * (see early-head) so the viewer never shows blank white; removed when the
 * artifact signals `shareout:content-ready` (the SDK emits this automatically
 * once its data calls settle), with load/timeout fallbacks so it never sticks.
 *
 * Warm-neutral palette per Design/visual/color.md (80% neutral, blue sparingly).
 */
import { colors } from '../../design-system/tokens';

export const LOADING_STYLES = `
    #so-loading {
      position: fixed; inset: 0; z-index: 2147483646;
      background: ${colors.bg};
      display: flex; flex-direction: column;
      gap: 16px; padding: clamp(16px, 4vw, 32px);
      opacity: 1; transition: opacity .3s ease;
    }
    #so-loading.so-loaded { opacity: 0; pointer-events: none; }
    .so-sk { background: ${colors.surface}; border-radius: 10px; position: relative; overflow: hidden; }
    .so-sk::after {
      content: ""; position: absolute; inset: 0; transform: translateX(-100%);
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent);
      animation: so-shimmer 1.4s infinite;
    }
    .so-sk-head { height: 40px; width: 36%; }
    .so-sk-row { display: flex; gap: 16px; }
    .so-sk-card { flex: 1; height: clamp(120px, 22vh, 200px); }
    .so-sk-line { height: 16px; }
    @keyframes so-shimmer { 100% { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) {
      .so-sk::after { animation: none; }
      #so-loading { transition: none; }
    }`;

export const LOADING_MARKUP = `<div id="so-loading" role="status" aria-label="Loading content" aria-live="polite">
    <div class="so-sk so-sk-head"></div>
    <div class="so-sk-row">
      <div class="so-sk so-sk-card"></div>
      <div class="so-sk so-sk-card"></div>
      <div class="so-sk so-sk-card"></div>
    </div>
    <div class="so-sk so-sk-line" style="width:92%"></div>
    <div class="so-sk so-sk-line" style="width:78%"></div>
    <div class="so-sk so-sk-line" style="width:85%"></div>
  </div>`;

/**
 * Removes the overlay once the artifact is ready. Hides on the EARLIEST of:
 *  - `shareout:content-ready` from our iframe (SDK auto-fires when data settles),
 *  - iframe `load` + a short grace (covers artifacts that never signal),
 *  - a hard cap so it can never stick on a stalled artifact.
 */
export function renderLoadingHideScript(): string {
  return `<script>
(function(){
  var o=document.getElementById('so-loading');if(!o)return;
  var f=document.querySelector('iframe');var done=false;
  // Diagnostic instrumentation for the "gray overlay stuck on open" report: logs each
  // hide trigger, and if the skeleton is still up past a threshold warns + posts a diag
  // up to the workspace shell (top-frame console). The hide behavior itself is unchanged.
  var t0=(window.performance&&performance.now)?performance.now():Date.now();
  var seen={ready:false,load:false};
  function el(){return Math.round(((window.performance&&performance.now)?performance.now():Date.now())-t0);}
  function log(m){try{console.log('[so-loading +'+el()+'ms] '+m+' '+JSON.stringify(seen)+' '+location.pathname);}catch(e){}}
  function post(reason){try{if(window.parent!==window)window.parent.postMessage({type:'shareout:loading-diag',reason:reason,ms:el(),seen:seen,visible:!done,art:location.pathname},'*');}catch(e){}}
  function hide(via){if(done)return;done=true;log('hide via '+via);post('hide:'+via);o.classList.add('so-loaded');setTimeout(function(){if(o&&o.parentNode)o.parentNode.removeChild(o);},350);}
  log('skeleton shown');
  window.addEventListener('message',function(e){if(f&&e.source!==f.contentWindow)return;if(e.data&&e.data.type==='shareout:content-ready'){seen.ready=true;hide('content-ready');}});
  if(f)f.addEventListener('load',function(){seen.load=true;log('iframe load');setTimeout(function(){hide('load+grace');},1500);});
  setTimeout(function(){if(!done){log('STILL VISIBLE at 4s');post('stuck-4s');}},4000);
  setTimeout(function(){if(!done){console.warn('[so-loading] STILL VISIBLE at 8s '+JSON.stringify(seen)+' '+location.pathname);post('stuck-8s');}},8000);
  setTimeout(function(){hide('cap-10s');},10000);
})();
</script>`;
}
