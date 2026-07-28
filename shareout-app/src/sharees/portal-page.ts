// External-sharing spine (work/030) — Phase 4. The "shared with me" portal.
// An authenticated external member lands here and sees ONLY the artifacts they were
// granted (direct or via a folder subtree), branded by their Sharee org. This is the
// external user's home — the surface that turns a one-off share into a relationship.
import type { Env } from '../types';
import { getSessionUser } from '../auth';
import { getVisibilityScope } from '../account-links';
import { renderHtmlPage } from '../design-system/shell';
import { escapeHtml } from '../html/utils';
import { listGrantedArtifacts, listGrantedFiles, resolvePortalBranding } from './portal';

const PORTAL_STYLES = `
  .pt-wrap { max-width: 880px; margin: 0 auto; padding: var(--space-12) var(--space-6); }
  .pt-head { display: flex; align-items: center; gap: var(--space-4); margin-bottom: var(--space-10); }
  .pt-logo { height: 40px; width: auto; border-radius: var(--radius-md); }
  .pt-title { font-size: var(--font-size-2xl); font-weight: 700; color: var(--color-text-primary); margin: 0; }
  .pt-sub { color: var(--color-text-secondary); margin: var(--space-1) 0 0; font-size: var(--font-size-sm); }
  .pt-grid { display: grid; gap: var(--space-4); }
  .pt-card { display: block; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); text-decoration: none; transition: border-color .15s, box-shadow .15s; }
  .pt-card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-sm); }
  .pt-card-name { font-weight: 600; color: var(--color-text-primary); }
  .pt-card-ws { color: var(--color-text-tertiary); font-size: var(--font-size-sm); margin-top: var(--space-1); }
  .pt-empty { text-align: center; color: var(--color-text-secondary); padding: var(--space-16) 0; }
  .pt-welcome { position: relative; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-5) var(--space-6); margin-bottom: var(--space-8); }
  .pt-welcome h2 { margin: 0 0 6px; font-size: 17px; font-weight: 700; color: var(--color-text); }
  .pt-welcome p { margin: 0; max-width: 60ch; font-size: 14px; line-height: 1.55; color: var(--color-text-secondary); }
  .pt-welcome-x { position: absolute; top: var(--space-3); right: var(--space-4); background: none; border: 0; color: var(--color-text-secondary); font-size: 13px; font-weight: 600; cursor: pointer; padding: 4px 8px; border-radius: var(--radius-md); }
  .pt-welcome-x:hover { color: var(--color-text); background: var(--color-surface); }
  .pt-welcome-x:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
  .pt-file .pt-file-main { display: block; text-decoration: none; }
  .pt-cmt-toggle { margin-top: var(--space-3); background: none; border: 0; padding: 0; color: var(--color-text-secondary); font-size: var(--font-size-sm); font-weight: 600; cursor: pointer; }
  .pt-cmt-toggle:hover { color: var(--color-primary); }
  .pt-thread { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--color-border); display: grid; gap: var(--space-2); }
  .pt-cmt { font-size: var(--font-size-sm); color: var(--color-text-secondary); line-height: 1.5; }
  .pt-cmt-author { font-weight: 600; color: var(--color-text-primary); }
  .pt-cmt-empty { font-size: var(--font-size-sm); color: var(--color-text-tertiary); }
  .pt-cmt-box { display: grid; gap: var(--space-2); margin-top: var(--space-2); }
  .pt-cmt-box .so-c-btn { justify-self: start; }
  .pt-cmt-in { width: 100%; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); font: inherit; resize: vertical; }
  .pt-cmt-msg { font-size: var(--font-size-sm); color: var(--color-error); }
`;

export async function handleSharedPortal(request: Request, env: Env): Promise<Response | null> {
  const user = await getSessionUser(request, env);
  if (!user) return null; // caller redirects to login

  const identity = await getVisibilityScope(env, user);
  const [artifacts, files, branding] = await Promise.all([
    listGrantedArtifacts(env, identity),
    listGrantedFiles(env, identity),
    resolvePortalBranding(env, identity),
  ]);
  const total = artifacts.length + files.length;

  const accent = branding?.color;
  const headerTitle = branding?.shareeName ? `${branding.shareeName} · Shared with you` : 'Shared with you';
  const logo = branding?.logo
    ? `<img class="pt-logo" src="${escapeHtml(branding.logo)}" alt="${escapeHtml(branding.shareeName ?? '')}">`
    : '';

  const artifactCards = artifacts.map(a => `
        <a class="pt-card" href="/a/${encodeURIComponent(a.slug)}/">
          <div class="pt-card-name">${escapeHtml(a.name || a.slug)}</div>
          ${a.workspace_name ? `<div class="pt-card-ws">${escapeHtml(a.workspace_name)}</div>` : ''}
        </a>`).join('');
  const fileCards = files.map(f => `
        <div class="pt-card pt-file" data-bucket="${escapeHtml(f.bucketId)}" data-dlv="${escapeHtml(f.id)}">
          <a class="pt-file-main" href="${escapeHtml(f.contentPath)}" download>
            <div class="pt-card-name">${escapeHtml(f.name || f.filename)}</div>
            <div class="pt-card-ws">${escapeHtml(f.workspace_name ? f.workspace_name + ' · ' : '')}File · download</div>
          </a>
          <button class="pt-cmt-toggle" type="button" data-cmt>Comments</button>
          <div class="pt-thread" hidden></div>
        </div>`).join('');
  const cards = total
    ? `<div class="pt-grid">${artifactCards}${fileCards}</div>`
    : `<div class="pt-empty">Nothing has been shared with you yet.</div>`;

  // First-run orientation — a client (often new to ShareOut) needs to know what this
  // place is and that commenting reaches the team. One-time, dismissed in localStorage
  // (cosmetic; no server state needed). Only shown once something's actually shared.
  const welcome = total ? `
      <div class="pt-welcome" id="ptWelcome">
        <button class="pt-welcome-x" id="ptWelcomeX" type="button">Got it</button>
        <h2>This is your shared space</h2>
        <p>Everything shared with you is here. Open any page to view it, and comment anywhere — the team will see it.</p>
      </div>
      <script>(function(){var w=document.getElementById('ptWelcome');if(!w)return;try{if(localStorage.getItem('so_portal_welcome')==='1'){w.style.display='none';return;}}catch(e){}var x=document.getElementById('ptWelcomeX');if(x)x.addEventListener('click',function(){try{localStorage.setItem('so_portal_welcome','1');}catch(e){}w.style.display='none';});})();</script>` : '';

  // Per-file comment threads. Same gated API the owner's lens uses
  // (/v1/data/{bucket}/comments, contextId file:<dlv>); the sharee's session + grant are
  // enforced server-side (view grant → read, comment grant → post; a view-only post 403s
  // and surfaces inline). Response envelope is { success, data: { comments } }.
  // Lazy-loaded on toggle; only emitted when files are present.
  const fileScript = files.length ? `
      <script>(function(){
        function esc(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML;}
        function base(c){return '/v1/data/'+encodeURIComponent(c.getAttribute('data-bucket'))+'/comments';}
        function ctx(c){return 'file:'+c.getAttribute('data-dlv');}
        function commentsOf(d){
          if(!d)return[];
          if(d.data&&Array.isArray(d.data.comments))return d.data.comments;
          if(Array.isArray(d.comments))return d.comments;
          return[];
        }
        function errMsg(j){
          if(!j)return'Could not comment.';
          // Data API: { success:false, error: string, code: string }
          if(typeof j.error==='string')return j.error;
          if(j.error&&j.error.message)return String(j.error.message);
          if(j.message)return String(j.message);
          return'Could not comment.';
        }
        function load(card,th){
          th.innerHTML='…';
          fetch(base(card)+'?contextId='+encodeURIComponent(ctx(card)),{credentials:'same-origin'})
            .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});})
            .then(function(res){
              if(!res.ok){th.innerHTML='<div class="pt-cmt-empty">'+esc(errMsg(res.j))+'</div>';return;}
              var cs=commentsOf(res.j);
              var list=cs.length?cs.map(function(c){return '<div class="pt-cmt"><span class="pt-cmt-author">'+esc(c.authorName)+'</span> '+esc(c.content)+'</div>';}).join(''):'<div class="pt-cmt-empty">No comments yet.</div>';
              th.innerHTML=list+'<div class="pt-cmt-box"><textarea class="pt-cmt-in" rows="2" placeholder="Add a comment…"></textarea><button class="so-c-btn so-c-btn--primary so-c-btn--sm" type="button">Send</button><div class="pt-cmt-msg"></div></div>';
              var send=th.querySelector('.pt-cmt-box .so-c-btn'),inp=th.querySelector('.pt-cmt-in'),msg=th.querySelector('.pt-cmt-msg');
              send.addEventListener('click',function(){
                var v=inp.value.trim();if(!v)return;
                send.disabled=true;msg.textContent='';
                fetch(base(card),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:v,contextId:ctx(card)})})
                  .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});})
                  .then(function(res){send.disabled=false;if(res.ok){inp.value='';load(card,th);}else{msg.textContent=errMsg(res.j);}})
                  .catch(function(){send.disabled=false;msg.textContent='Could not comment.';});
              });
            }).catch(function(){th.innerHTML='<div class="pt-cmt-empty">Could not load comments.</div>';});
        }
        document.addEventListener('click',function(ev){
          var btn=ev.target.closest&&ev.target.closest('[data-cmt]');if(!btn)return;
          var card=btn.closest('.pt-file'),th=card.querySelector('.pt-thread');
          if(!th.hidden){th.hidden=true;return;}
          th.hidden=false;load(card,th);
        });
      })();</script>` : '';

  const body = `
    <div class="pt-wrap"${accent ? ` style="--color-primary: ${escapeHtml(accent)}"` : ''}>
      <div class="pt-head">
        ${logo}
        <div>
          <h1 class="pt-title">${escapeHtml(headerTitle)}</h1>
          <p class="pt-sub">${total} item${total === 1 ? '' : 's'} shared with you</p>
        </div>
      </div>
      ${welcome}
      ${cards}
    </div>${fileScript}`;

  return renderHtmlPage({
    title: headerTitle,
    description: 'Resources shared with you on ShareOut.',
    pageStyles: PORTAL_STYLES,
    body,
    cacheControl: 'no-store',
  });
}
