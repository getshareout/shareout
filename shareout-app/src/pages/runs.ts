import { renderHtmlPage } from '../design-system/shell';
import { colors } from '../design-system/tokens';
import { escapeHtml } from '../html/utils';
import { RUN_DRAWER_JS } from '../runs/run-drawer-client';
import type { Env } from '../types';

interface SessionUser { id: string; email: string; name?: string }

// Run Inspector hub: a filterable table of recent runs across all three
// automation surfaces (crew / job / alert) for one workspace. Thin shell — the
// client fetches /v1/workspaces/{ws}/runs (admin-gated) and opens the shared
// run drawer on row click. Workspace comes from ?ws=.
export async function renderRunsPage(request: Request, env: Env, _user: SessionUser): Promise<Response> {
  const url = new URL(request.url);
  const ws = url.searchParams.get('ws') || '';

  if (!ws) {
    return renderHtmlPage({
      title: 'Runs · ShareOut',
      pageStyles: STYLES,
      body: `<main class="rn-wrap"><div class="rn-empty">Open this from a Team Space (<a href="/home">Home</a>) to see its runs.</div></main>`,
      status: 400,
    });
  }

  const body = `
    <main class="rn-wrap">
      <header class="rn-head">
        <a class="rn-back" href="/home">← Home</a>
        <h1>Runs</h1>
        <p class="rn-sub">Every crew, schedule and alert run in this workspace. Click a run to inspect its steps.</p>
      </header>
      <div class="rn-filters">
        <div class="rn-seg" data-filter="surface">
          <button class="is-on" data-val="">All</button>
          <button data-val="crew">Crew</button>
          <button data-val="job">Schedules</button>
          <button data-val="alert">Alerts</button>
        </div>
        <div class="rn-seg" data-filter="status">
          <button class="is-on" data-val="">Any status</button>
          <button data-val="success">Succeeded</button>
          <button data-val="failed">Failed</button>
        </div>
      </div>
      <div id="rn-list" class="rn-list"><div class="rn-empty">Loading…</div></div>
    </main>`;

  return renderHtmlPage({
    title: 'Runs · ShareOut',
    pageStyles: STYLES,
    body,
    scripts: `window.WSX_WS=${JSON.stringify(ws)};\n${RUN_DRAWER_JS}\n${PAGE_JS}`,
  });
}

const STYLES = `
  .rn-wrap{max-width:980px;margin:0 auto;padding:32px 20px 80px}
  .rn-head{margin:0 0 22px}
  .rn-back{font:500 .85rem var(--font-body);color:var(--color-text-tertiary);text-decoration:none}
  .rn-back:hover{color:var(--color-text-secondary)}
  .rn-head h1{margin:10px 0 2px;font:700 1.6rem var(--font-display,var(--font-body));color:var(--color-text)}
  .rn-sub{margin:0;color:var(--color-text-tertiary);font:400 .9rem var(--font-body)}
  .rn-filters{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 18px}
  .rn-seg{display:inline-flex;background:var(--color-surface-sunken,${colors.surface});border-radius:10px;padding:3px}
  .rn-seg button{border:none;background:transparent;cursor:pointer;font:600 .8rem var(--font-body);color:var(--color-text-secondary);padding:6px 12px;border-radius:8px}
  .rn-seg button.is-on{background:var(--color-surface,${colors.bgElevated});color:var(--color-text);box-shadow:0 1px 2px rgba(28,25,23,.08)}
  .rn-list{display:flex;flex-direction:column;border:1px solid var(--color-border);border-radius:14px;overflow:hidden;background:var(--color-surface,${colors.bgElevated})}
  .rn-row{display:grid;grid-template-columns:74px 1fr auto;align-items:center;gap:14px;padding:13px 16px;cursor:pointer;border-top:1px solid var(--color-border-subtle,var(--color-border));text-align:left;background:none;font:inherit;width:100%}
  .rn-row:first-child{border-top:none}
  .rn-row:hover{background:var(--color-surface-sunken,${colors.surface})}
  .rn-tag{font:600 .68rem var(--font-body);text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-tertiary)}
  .rn-name{font:600 .9rem var(--font-body);color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rn-meta{font:400 .76rem var(--font-body);color:var(--color-text-tertiary);margin-top:2px}
  .rn-right{display:flex;align-items:center;gap:12px}
  .rn-dur{font:400 .78rem var(--font-body);color:var(--color-text-tertiary)}
  .rn-badge{display:inline-block;padding:3px 9px;border-radius:999px;font:600 .7rem var(--font-body);text-transform:capitalize}
  .rn-badge.ok{background:color-mix(in srgb,${colors.success} 14%,transparent);color:${colors.success}}
  .rn-badge.fail{background:color-mix(in srgb,${colors.error} 14%,transparent);color:${colors.error}}
  .rn-badge.pend{background:color-mix(in srgb,${colors.warning} 16%,transparent);color:${colors.warning}}
  .rn-empty{color:var(--color-text-tertiary);font:400 .9rem var(--font-body);padding:40px 16px;text-align:center}`;

const PAGE_JS = String.raw`
(function(){
  var ws=window.WSX_WS, filt={surface:'',status:''};
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  var OK={done:1,success:1,delivered:1,ok:1};
  function cls(s){ if(OK[s])return 'ok'; if(s==='matched'||s==='pending'||s==='running')return 'pend'; return 'fail'; }
  function dur(ms){ if(ms==null)return ''; if(ms<1000)return ms+'ms'; return (ms/1000).toFixed(1)+'s'; }
  function ago(v){ if(!v)return ''; var d=new Date(v); var s=Math.floor((Date.now()-d.getTime())/1000); if(isNaN(s))return '';
    if(s<60)return s+'s ago'; if(s<3600)return Math.floor(s/60)+'m ago'; if(s<86400)return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; }
  var LABEL={crew:'Crew',job:'Schedule',alert:'Alert'};
  function load(){
    var m=document.getElementById('rn-list'); m.innerHTML='<div class="rn-empty">Loading…</div>';
    var q=[]; if(filt.surface)q.push('surface='+filt.surface); if(filt.status)q.push('status='+filt.status);
    fetch('/v1/workspaces/'+encodeURIComponent(ws)+'/runs'+(q.length?'?'+q.join('&'):''),{credentials:'same-origin'})
      .then(function(r){ return r.ok?r.json():null; })
      .then(function(d){
        var runs=d&&d.runs||[];
        if(!runs.length){ m.innerHTML='<div class="rn-empty">No runs yet.</div>'; return; }
        m.innerHTML=runs.map(function(r){
          var meta=[ago(r.startedAt), r.trigger].filter(Boolean).join(' · ');
          return '<button class="rn-row" data-surface="'+esc(r.surface)+'" data-id="'+esc(r.id)+'" type="button">'
            +'<span class="rn-tag">'+esc(LABEL[r.surface]||r.surface)+'</span>'
            +'<span><span class="rn-name">'+esc(r.source||'Run')+'</span><span class="rn-meta">'+esc(meta)+'</span></span>'
            +'<span class="rn-right">'+(r.durationMs!=null?'<span class="rn-dur">'+esc(dur(r.durationMs))+'</span>':'')+'<span class="rn-badge '+cls(r.status)+'">'+esc(r.status)+'</span></span>'
            +'</button>';
        }).join('');
        m.querySelectorAll('.rn-row').forEach(function(b){ b.addEventListener('click',function(){ if(window.SO_openRunDrawer)window.SO_openRunDrawer(b.getAttribute('data-surface'),b.getAttribute('data-id')); }); });
      }).catch(function(){ m.innerHTML='<div class="rn-empty">Could not load runs.</div>'; });
  }
  document.querySelectorAll('.rn-seg').forEach(function(seg){
    var key=seg.getAttribute('data-filter');
    seg.querySelectorAll('button').forEach(function(b){ b.addEventListener('click',function(){
      seg.querySelectorAll('button').forEach(function(x){ x.classList.remove('is-on'); }); b.classList.add('is-on');
      filt[key]=b.getAttribute('data-val'); load();
    }); });
  });
  load();
})();
`;
