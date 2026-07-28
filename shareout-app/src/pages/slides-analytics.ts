import { renderHtmlPage } from '../design-system/shell';
import { escapeHtml } from '../html/utils';
import type { Env } from '../types';

interface SessionUser { id: string; email: string; name?: string }

// Owner-only deck analytics dashboard (Slides B2B P2 UI). Reads the capture
// pipeline from #603/#609 and the tracked links from #604. The page is a thin
// shell; the client fetches /v1/data/{artifact}/slides/{pres}/analytics + /links
// with the session cookie (verifyOwner accepts it), so no data is inlined.
export async function renderSlidesAnalyticsPage(
  request: Request,
  env: Env,
  user: SessionUser,
  artifactId: string,
): Promise<Response> {
  const artifact = await env.DB.prepare(
    `SELECT id, name, owner_id FROM artifacts WHERE id = ?`
  ).bind(artifactId).first<{ id: string; name: string; owner_id: string | null }>();

  if (!artifact) return forbidden('Deck not found');

  let authorized = artifact.owner_id === user.id;
  if (!authorized && artifact.owner_id) {
    const collab = await env.DB.prepare(
      `SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?`
    ).bind(artifactId, user.email).first<{ role: string }>();
    authorized = !!collab && collab.role !== 'viewer';
  }
  if (!authorized) return forbidden('You do not have access to this deck.');

  const pres = await env.DB.prepare(
    `SELECT id, title FROM presentations WHERE artifact_id = ? ORDER BY created_at ASC LIMIT 1`
  ).bind(artifactId).first<{ id: string; title: string }>();

  const deckName = pres?.title || artifact.name;

  const body = `
    <main class="sa-wrap">
      <header class="sa-head">
        <a class="sa-back" href="/a/${escapeHtml(artifact.name)}/edit">← Back to editor</a>
        <h1>${escapeHtml(deckName)}</h1>
        <p class="sa-sub">Viewer engagement &amp; tracked links</p>
      </header>
      ${pres ? `
      <section id="sa-summary" class="sa-stats"></section>
      <section class="sa-card">
        <h2>Per-slide engagement</h2>
        <div id="sa-slides" class="sa-slides"><div class="sa-empty">Loading…</div></div>
      </section>
      <section class="sa-card">
        <h2>Sessions</h2>
        <div id="sa-sessions"></div>
      </section>
      <section class="sa-card">
        <div class="sa-links-head"><h2>Tracked links</h2></div>
        <form id="sa-link-form" class="sa-link-form">
          <input name="recipientLabel" placeholder="Recipient (e.g. Acme Corp)" autocomplete="off" />
          <select name="gate">
            <option value="none">No gate</option>
            <option value="email">Require email</option>
            <option value="domain">Require domain</option>
            <option value="password">Require password</option>
          </select>
          <input name="gateValue" class="sa-gateval" placeholder="domain.com or password" style="display:none" autocomplete="off" />
          <button type="submit">Create link</button>
        </form>
        <div id="sa-links"></div>
      </section>
      ` : `<section class="sa-card"><div class="sa-empty">This artifact has no presentation yet.</div></section>`}
    </main>`;

  return renderHtmlPage({
    title: `${deckName} — Analytics · ShareOut`,
    pageStyles: STYLES,
    body,
    scripts: pres ? clientScript(artifactId, pres.id) : '',
  });
}

function forbidden(msg: string): Response {
  return renderHtmlPage({
    title: 'Not available · ShareOut',
    pageStyles: STYLES,
    body: `<main class="sa-wrap"><section class="sa-card"><div class="sa-empty">${escapeHtml(msg)}</div></section></main>`,
    status: 403,
  });
}

const STYLES = `
  .sa-wrap{max-width:920px;margin:0 auto;padding:32px 20px 80px}
  .sa-head{margin:0 0 24px}
  .sa-back{font:500 .85rem var(--font-body);color:var(--color-text-tertiary);text-decoration:none}
  .sa-back:hover{color:var(--color-text-secondary)}
  .sa-head h1{margin:10px 0 2px;font:700 1.6rem var(--font-display,var(--font-body));color:var(--color-text)}
  .sa-sub{margin:0;color:var(--color-text-tertiary);font:400 .9rem var(--font-body)}
  .sa-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0 0 20px}
  @media(max-width:640px){.sa-stats{grid-template-columns:repeat(2,1fr)}}
  .sa-stat{background:var(--color-surface,#fff);border:1px solid var(--color-border);border-radius:14px;padding:16px}
  .sa-stat-val{font:700 1.5rem var(--font-body);color:var(--color-text)}
  .sa-stat-lbl{margin-top:2px;font:500 .78rem var(--font-body);color:var(--color-text-tertiary)}
  .sa-card{background:var(--color-surface,#fff);border:1px solid var(--color-border);border-radius:16px;padding:20px;margin:0 0 18px}
  .sa-card h2{margin:0 0 14px;font:600 1rem var(--font-body);color:var(--color-text)}
  .sa-slides{display:flex;flex-direction:column;gap:8px}
  .sa-srow{display:grid;grid-template-columns:46px 1fr 64px;align-items:center;gap:10px}
  .sa-sidx{font:600 .8rem var(--font-body);color:var(--color-text-tertiary)}
  .sa-bar{height:22px;background:var(--color-surface-sunken,#f1f3f5);border-radius:6px;overflow:hidden;position:relative}
  .sa-bar-fill{height:100%;background:var(--color-primary,#2563eb);border-radius:6px;min-width:2px}
  .sa-bar-drop{position:absolute;inset:0;background:repeating-linear-gradient(45deg,transparent,transparent 5px,color-mix(in srgb,#ef4444 14%,transparent) 5px,color-mix(in srgb,#ef4444 14%,transparent) 10px)}
  .sa-sval{font:500 .78rem var(--font-body);color:var(--color-text-secondary);text-align:right}
  table.sa-tbl{width:100%;border-collapse:collapse;font:400 .85rem var(--font-body)}
  .sa-tbl th{text-align:left;padding:8px 10px;color:var(--color-text-tertiary);font-weight:600;border-bottom:1px solid var(--color-border);font-size:.75rem;text-transform:uppercase;letter-spacing:.03em}
  .sa-tbl td{padding:9px 10px;border-bottom:1px solid var(--color-border-subtle,var(--color-border));color:var(--color-text)}
  .sa-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:600}
  .sa-pill.ok{background:color-mix(in srgb,#16a34a 14%,transparent);color:#16a34a}
  .sa-empty{color:var(--color-text-tertiary);font:400 .9rem var(--font-body);padding:8px 0}
  .sa-link-form{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
  .sa-link-form input,.sa-link-form select{padding:8px 10px;border:1px solid var(--color-border);border-radius:8px;font:400 .85rem var(--font-body);background:var(--color-surface,#fff);color:var(--color-text)}
  .sa-link-form input[name=recipientLabel]{flex:1;min-width:160px}
  .sa-link-form button{padding:8px 14px;border:0;border-radius:8px;background:var(--color-primary,#2563eb);color:#fff;font:600 .85rem var(--font-body);cursor:pointer}
  .sa-copy,.sa-revoke{cursor:pointer;border:0;background:none;font:500 .8rem var(--font-body);padding:2px 6px}
  .sa-copy{color:var(--color-primary,#2563eb)}
  .sa-revoke{color:#ef4444}
`;

function clientScript(artifactId: string, presId: string): string {
  return `(function(){
  var BASE='/v1/data/${artifactId}/slides/${presId}';
  function get(p){return fetch(BASE+p,{credentials:'include'}).then(function(r){return r.json();});}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function fmtDur(ms){ms=ms||0;var s=Math.round(ms/1000);if(s<60)return s+'s';var m=Math.floor(s/60);return m+'m '+(s%60)+'s';}
  function pct(x){return Math.round((x||0)*100)+'%';}

  function renderSummary(s){
    var cards=[['Views',s.totalViews],['Unique',s.uniqueViewers],['Avg time',fmtDur(s.avgDurationMs)],['Completion',pct(s.completionRate)]];
    document.getElementById('sa-summary').innerHTML=cards.map(function(c){
      return '<div class="sa-stat"><div class="sa-stat-val">'+esc(c[1])+'</div><div class="sa-stat-lbl">'+esc(c[0])+'</div></div>';
    }).join('');
  }
  function renderSlides(rows){
    var el=document.getElementById('sa-slides');
    if(!rows||!rows.length){el.innerHTML='<div class="sa-empty">No views yet. Share the deck to start collecting engagement.</div>';return;}
    var maxDwell=Math.max.apply(null,rows.map(function(r){return r.avgDwellMs||0;}).concat([1]));
    el.innerHTML=rows.map(function(r){
      var w=Math.max((r.avgDwellMs/maxDwell)*100,2);
      var drop=r.dropOffRate>0.001?'<div class="sa-bar-drop" title="'+pct(r.dropOffRate)+' dropped off here"></div>':'';
      return '<div class="sa-srow"><div class="sa-sidx">#'+(r.slideIndex+1)+'</div>'+
        '<div class="sa-bar"><div class="sa-bar-fill" style="width:'+w+'%"></div>'+drop+'</div>'+
        '<div class="sa-sval">'+fmtDur(r.avgDwellMs)+'</div></div>';
    }).join('');
  }
  function renderSessions(rows){
    var el=document.getElementById('sa-sessions');
    if(!rows||!rows.length){el.innerHTML='<div class="sa-empty">No sessions yet.</div>';return;}
    var head='<tr><th>Viewer</th><th>Where</th><th>Slides</th><th>Time</th><th>Done</th><th>When</th></tr>';
    var body=rows.map(function(s){
      var who=esc(s.viewerEmail||'Anonymous');
      var where=[s.device,s.country].filter(Boolean).map(esc).join(' · ')||'—';
      var done=s.completed?'<span class="sa-pill ok">yes</span>':'—';
      var when=new Date(s.startedAt).toLocaleString();
      return '<tr><td>'+who+'</td><td>'+where+'</td><td>'+esc(s.slidesSeen)+'</td><td>'+fmtDur(s.durationMs)+'</td><td>'+done+'</td><td>'+esc(when)+'</td></tr>';
    }).join('');
    el.innerHTML='<table class="sa-tbl">'+head+body+'</table>';
  }
  function renderLinks(rows){
    var el=document.getElementById('sa-links');
    if(!rows||!rows.length){el.innerHTML='<div class="sa-empty">No tracked links yet. Create one to attribute views to a recipient.</div>';return;}
    var head='<tr><th>Recipient</th><th>Gate</th><th>Views</th><th>Link</th><th></th></tr>';
    var body=rows.map(function(l){
      var rev=l.revoked?' (revoked)':'';
      var copy=l.revoked?'':'<button class="sa-copy" data-url="'+esc(l.url)+'">Copy</button>';
      var revoke=l.revoked?'':'<button class="sa-revoke" data-id="'+esc(l.id)+'">Revoke</button>';
      return '<tr><td>'+esc(l.recipientLabel||'—')+rev+'</td><td>'+esc(l.gate)+'</td><td>'+esc(l.views)+'</td><td>'+copy+'</td><td>'+revoke+'</td></tr>';
    }).join('');
    el.innerHTML='<table class="sa-tbl">'+head+body+'</table>';
    el.querySelectorAll('.sa-copy').forEach(function(b){b.onclick=function(){navigator.clipboard.writeText(b.getAttribute('data-url'));b.textContent='Copied';setTimeout(function(){b.textContent='Copy';},1200);};});
    el.querySelectorAll('.sa-revoke').forEach(function(b){b.onclick=function(){
      if(!confirm('Revoke this link? Existing analytics are kept.'))return;
      fetch(BASE+'/links/'+b.getAttribute('data-id'),{method:'DELETE',credentials:'include'}).then(loadLinks);
    };});
  }
  function loadLinks(){get('/links').then(function(r){if(r&&r.success)renderLinks(r.data.links);});}
  function loadAnalytics(){get('/analytics').then(function(r){if(r&&r.success){renderSummary(r.data.summary);renderSlides(r.data.perSlide);renderSessions(r.data.sessions);}});}

  var form=document.getElementById('sa-link-form');
  var gate=form.querySelector('[name=gate]'), gv=form.querySelector('.sa-gateval');
  gate.onchange=function(){var g=gate.value;gv.style.display=(g==='domain'||g==='password')?'':'none';gv.placeholder=g==='domain'?'acme.com':'password';};
  form.onsubmit=function(ev){ev.preventDefault();
    var g=gate.value,payload={recipientLabel:form.recipientLabel.value||undefined,gate:g};
    if(g==='password')payload.password=gv.value;
    if(g==='domain')payload.domains=gv.value.split(',').map(function(s){return s.trim();}).filter(Boolean);
    fetch(BASE+'/links',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){return r.json();}).then(function(){form.reset();gv.style.display='none';loadLinks();});
  };

  loadAnalytics();loadLinks();
})();`;
}
