/**
 * Run Inspector drawer — shared browser script. Defines a global
 * `window.SO_openRunDrawer(surface, runId)` that slides in a right-side panel
 * showing one run's normalized detail (header, step timeline, delivery, result,
 * error) fetched from `/v1/workspaces/{ws}/runs/{surface}/{runId}`.
 *
 * Self-contained: injects its own CSS once (token vars with literal fallbacks so
 * it renders both inside the home shell and on the standalone /app/runs page).
 * Included by the workspace client bundle and by renderRunsPage.
 */
import { colors } from '../design-system/tokens';

export const RUN_DRAWER_JS = `(function(){
  if (window.SO_openRunDrawer) return;
  var CSS = ''
    + '.so-rd-ov{position:fixed;inset:0;z-index:9000;background:rgba(28,25,23,.38);opacity:0;transition:opacity .18s ease}'
    + '.so-rd-ov.is-on{opacity:1}'
    + '.so-rd{position:fixed;top:0;right:0;height:100%;width:min(540px,94vw);z-index:9001;background:var(--color-bg-elevated,${colors.bgElevated});'
    + 'box-shadow:-12px 0 40px rgba(28,25,23,.18);display:flex;flex-direction:column;transform:translateX(100%);transition:transform .2s ease}'
    + '.so-rd.is-on{transform:translateX(0)}'
    + '.so-rd__head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px;border-bottom:1px solid var(--color-border,${colors.border})}'
    + '.so-rd__ttl{flex:1;min-width:0}'
    + '.so-rd__ttl b{display:block;font-size:var(--text-base,15px);color:var(--color-text,${colors.text});overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.so-rd__sub{font-size:var(--text-xs,12px);color:var(--color-text-tertiary,${colors.textTertiary});margin-top:3px}'
    + '.so-rd__x{border:none;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:var(--color-text-tertiary,${colors.textTertiary});padding:0 2px}'
    + '.so-rd__body{flex:1;overflow:auto;padding:18px 20px}'
    + '.so-rd__badge{display:inline-flex;align-items:center;font:600 var(--text-xs,12px)/1 system-ui;padding:4px 10px;border-radius:999px;text-transform:capitalize}'
    + '.so-rd__badge.ok{background:rgba(22,163,74,.12);color:var(--color-success,${colors.success})}'
    + '.so-rd__badge.fail{background:rgba(220,38,38,.12);color:var(--color-danger,${colors.error})}'
    + '.so-rd__badge.pend{background:rgba(202,138,4,.14);color:var(--color-warning,${colors.warning})}'
    + '.so-rd__stats{display:flex;flex-wrap:wrap;gap:14px;margin:14px 0 4px;font-size:var(--text-xs,12px);color:var(--color-text-secondary,${colors.textSecondary})}'
    + '.so-rd__stats b{color:var(--color-text,${colors.text});font-weight:600}'
    + '.so-rd__sect{font:600 var(--text-xs,12px)/1 system-ui;letter-spacing:.04em;text-transform:uppercase;color:var(--color-text-tertiary,${colors.textTertiary});margin:20px 0 10px}'
    + '.so-rd__step{border:1px solid var(--color-border,${colors.border});border-radius:var(--radius-md,10px);margin-bottom:8px;overflow:hidden}'
    + '.so-rd__step.is-fail{border-color:var(--color-danger,${colors.error});background:rgba(220,38,38,.04)}'
    + '.so-rd__step > summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px 12px}'
    + '.so-rd__step > summary::-webkit-details-marker{display:none}'
    + '.so-rd__dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--color-text-tertiary,${colors.textTertiary})}'
    + '.so-rd__dot.ok{background:var(--color-success,${colors.success})}.so-rd__dot.fail{background:var(--color-danger,${colors.error})}.so-rd__dot.pend{background:var(--color-warning,${colors.warning})}'
    + '.so-rd__stype{font-weight:600;color:var(--color-text,${colors.text});font-size:var(--text-sm,13px)}'
    + '.so-rd__slabel{color:var(--color-text-secondary,${colors.textSecondary});font-size:var(--text-xs,12px)}'
    + '.so-rd__sdur{margin-left:auto;color:var(--color-text-tertiary,${colors.textTertiary});font-size:var(--text-xs,12px)}'
    + '.so-rd__io{margin:0;padding:10px 12px;border-top:1px solid var(--color-border,${colors.border});background:var(--color-surface,${colors.surface});'
    + 'font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;color:var(--color-text-secondary,${colors.textSecondary});max-height:280px;overflow:auto}'
    + '.so-rd__result{white-space:pre-wrap;font-size:var(--text-sm,13px);color:var(--color-text,${colors.text});background:var(--color-surface,${colors.surface});'
    + 'border:1px solid var(--color-border,${colors.border});border-radius:var(--radius-md,10px);padding:12px;max-height:300px;overflow:auto}'
    + '.so-rd__err{background:rgba(220,38,38,.08);color:var(--color-danger,${colors.error});border-radius:var(--radius-md,10px);padding:12px;font-size:var(--text-sm,13px);white-space:pre-wrap}'
    + '.so-rd__foot{padding:14px 20px;border-top:1px solid var(--color-border,${colors.border});display:flex;gap:8px}'
    + '.so-rd__btn{border:1.5px solid var(--color-border,${colors.border});background:var(--color-bg-elevated,${colors.bgElevated});border-radius:var(--radius-md,10px);'
    + 'min-height:34px;padding:0 14px;font:600 var(--text-sm,13px) system-ui;cursor:pointer;color:var(--color-text,${colors.text})}'
    + '.so-rd__btn:hover{border-color:var(--color-primary,${colors.primary})}'
    + '.so-rd__msg{color:var(--color-text-tertiary,${colors.textTertiary});font-size:var(--text-sm,13px);padding:24px 0;text-align:center}'
    + '.so-runbar.is-click{cursor:pointer}.so-runbar.is-click:hover{outline:2px solid var(--color-primary,${colors.primary});outline-offset:1px}';

  function ensureCss(){ if(document.getElementById('so-rd-css'))return; var s=document.createElement('style'); s.id='so-rd-css'; s.textContent=CSS; document.head.appendChild(s); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  var OK={done:1,success:1,delivered:1,ok:1};
  function cls(s){ if(OK[s])return 'ok'; if(s==='running'||s==='pending'||s==='matched')return 'pend'; return 'fail'; }
  function dur(ms){ if(ms==null)return ''; if(ms<1000)return ms+'ms'; return (ms/1000).toFixed(1)+'s'; }
  function cost(m){ if(!m)return ''; return '$'+(m/1e6).toFixed(m<10000?4:2); }
  function tstr(v){ if(v==null)return ''; var d=typeof v==='number'?new Date(v*1000):new Date(v); return isNaN(d.getTime())?'':d.toISOString().replace('T',' ').slice(0,19)+' UTC'; }
  function jstr(v){ if(v==null)return ''; if(typeof v==='string')return v; try{return JSON.stringify(v,null,2);}catch(e){return String(v);} }

  function stepRow(s){
    var io = [s.input,s.output].map(jstr).filter(Boolean).join('\\n\\n');
    var inner = '<span class="so-rd__dot '+cls(s.status||'')+'"></span>'
      + '<span class="so-rd__stype">'+esc(s.type||'step')+'</span>'
      + (s.label?'<span class="so-rd__slabel">'+esc(s.label)+'</span>':'')
      + (s.durationMs!=null?'<span class="so-rd__sdur">'+esc(dur(s.durationMs))+'</span>':'');
    var cz = 'so-rd__step'+(cls(s.status)==='fail'?' is-fail':'');
    if(!io) return '<div class="'+cz+'"><div style="display:flex;align-items:center;gap:10px;padding:10px 12px">'+inner+'</div></div>';
    return '<details class="'+cz+'"><summary>'+inner+'</summary><pre class="so-rd__io">'+esc(io)+'</pre></details>';
  }

  function render(run, body, foot){
    var stats = [];
    if(run.startedAt) stats.push('<span>'+esc(tstr(run.startedAt))+'</span>');
    if(run.durationMs!=null) stats.push('<span><b>'+esc(dur(run.durationMs))+'</b> duration</span>');
    if(run.costMicroUsd) stats.push('<span><b>'+esc(cost(run.costMicroUsd))+'</b></span>');
    if(run.tokenInput||run.tokenOutput) stats.push('<span>'+(run.tokenInput||0)+' in / '+(run.tokenOutput||0)+' out tok</span>');
    if(run.model) stats.push('<span>'+esc(String(run.model).replace('claude-','').replace(/-\\d+$/,''))+'</span>');
    var steps = (run.steps||[]).map(stepRow).join('') || '<div class="so-rd__msg">No steps recorded for this run.</div>';
    body.innerHTML = '<div class="so-rd__stats">'+stats.join('')+'</div>'
      + '<div class="so-rd__sect">Timeline</div>'+steps
      + (run.delivery&&run.delivery.kind?'<div class="so-rd__sect">Delivery</div><div class="so-rd__step"><div style="padding:10px 12px"><span class="so-rd__dot '+cls(run.delivery.status)+'"></span> <span class="so-rd__stype">'+esc(run.delivery.kind)+'</span> <span class="so-rd__slabel">'+esc(run.delivery.status||'')+'</span></div></div>':'')
      + (run.error?'<div class="so-rd__sect">Error</div><div class="so-rd__err">'+esc(run.error)+'</div>':'')
      + (run.result?'<div class="so-rd__sect">Result</div><div class="so-rd__result">'+esc(run.result)+'</div>':'');
    foot.innerHTML = run.rerunPath?'<button class="so-rd__btn" data-rerun="'+esc(run.rerunPath)+'" type="button">Run now</button>':'';
    var rb=foot.querySelector('[data-rerun]');
    if(rb) rb.addEventListener('click',function(){ rb.disabled=true; rb.textContent='Running…';
      fetch(rb.getAttribute('data-rerun'),{method:'POST',credentials:'same-origin'}).then(function(){ rb.textContent='Queued ✓'; }).catch(function(){ rb.textContent='Failed'; }); });
  }

  window.SO_openRunDrawer = function(surface, runId){
    ensureCss();
    var ws = window.WSX_WS || '';
    var ov=document.createElement('div'); ov.className='so-rd-ov';
    var dr=document.createElement('div'); dr.className='so-rd';
    dr.innerHTML='<div class="so-rd__head"><div class="so-rd__ttl"><b>Run</b><div class="so-rd__sub">Loading…</div></div><button class="so-rd__x" type="button" aria-label="Close">×</button></div><div class="so-rd__body"></div><div class="so-rd__foot"></div>';
    document.body.appendChild(ov); document.body.appendChild(dr);
    requestAnimationFrame(function(){ ov.classList.add('is-on'); dr.classList.add('is-on'); });
    function close(){ ov.classList.remove('is-on'); dr.classList.remove('is-on'); document.removeEventListener('keydown',onKey); setTimeout(function(){ ov.remove(); dr.remove(); },200); }
    function onKey(e){ if(e.key==='Escape')close(); }
    ov.addEventListener('click',close); dr.querySelector('.so-rd__x').addEventListener('click',close); document.addEventListener('keydown',onKey);
    var body=dr.querySelector('.so-rd__body'), foot=dr.querySelector('.so-rd__foot');
    if(!ws){ body.innerHTML='<div class="so-rd__msg">Open this from a Team Space to inspect the run.</div>'; return; }
    fetch('/v1/workspaces/'+encodeURIComponent(ws)+'/runs/'+encodeURIComponent(surface)+'/'+encodeURIComponent(runId),{credentials:'same-origin'})
      .then(function(r){ return r.ok?r.json():null; })
      .then(function(d){
        var run=d&&d.run; if(!run){ body.innerHTML='<div class="so-rd__msg">Run details unavailable.</div>'; return; }
        dr.querySelector('.so-rd__ttl b').textContent=run.source||(surface+' run');
        dr.querySelector('.so-rd__sub').innerHTML='<span class="so-rd__badge '+cls(run.status)+'">'+esc(run.status)+'</span>'+(run.trigger?' &nbsp; '+esc(run.trigger):'');
        render(run, body, foot);
      }).catch(function(){ body.innerHTML='<div class="so-rd__msg">Could not load run.</div>'; });
  };
})();
`;
