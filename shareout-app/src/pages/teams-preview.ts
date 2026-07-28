import { renderHtmlPage } from '../design-system/shell';
import { brandLockupHtml } from '../brand';
import { getPlatformHostname } from '../config/origins';
import type { Env } from '../types';

function sanitizeSlug(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'acme';
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface Artifact {
  name: string;
  type: 'App' | 'Data' | 'Doc' | 'Deck';
  vis: 'Private' | 'Shared' | 'Public';
  views: string;
  team: string;
  agent?: boolean;
}

const TYPE_COLOR: Record<Artifact['type'], string> = {
  App: '#2563eb',
  Data: '#16a34a',
  Doc: '#8b5cf6',
  Deck: '#d97706',
};

const TYPE_SVG: Record<Artifact['type'], string> = {
  App: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  Data: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
  Doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  Deck: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
};

const ARTIFACTS: Artifact[] = [
  { name: 'Q4 Board Deck', type: 'Deck', vis: 'Shared', views: '1.2k', team: 'Finance' },
  { name: 'Revenue Dashboard', type: 'App', vis: 'Private', views: '3.4k', team: 'Finance', agent: true },
  { name: 'Pricing Calculator', type: 'App', vis: 'Public', views: '890', team: 'Sales' },
  { name: 'Churn Report', type: 'Data', vis: 'Private', views: '540', team: 'Product', agent: true },
  { name: 'Supplier Portal', type: 'App', vis: 'Shared', views: '210', team: 'Suppliers' },
  { name: 'Brand Guidelines', type: 'Doc', vis: 'Public', views: '2.1k', team: 'Marketing' },
  { name: 'Hiring Tracker', type: 'App', vis: 'Private', views: '320', team: 'People' },
  { name: 'Investor Update', type: 'Doc', vis: 'Shared', views: '670', team: 'Finance' },
  { name: 'Inventory App', type: 'App', vis: 'Private', views: '1.5k', team: 'Product' },
  { name: 'Ad Performance', type: 'Data', vis: 'Private', views: '780', team: 'Marketing', agent: true },
  { name: 'Onboarding Hub', type: 'Doc', vis: 'Shared', views: '1.1k', team: 'People' },
  { name: 'NPS Survey', type: 'App', vis: 'Public', views: '430', team: 'Product' },
];

const TEAMS = ['Marketing', 'Finance', 'Product', 'Sales', 'People', 'Suppliers'];

export function renderTeamsPreviewPage(rawName: string, env: Env): Response {
  const slug = sanitizeSlug(rawName);
  const title = titleCase(slug);
  const host = `${slug}.${getPlatformHostname(env)}`;

  const visClass = (v: Artifact['vis']) => v === 'Public' ? 'pub' : v === 'Shared' ? 'shared' : 'priv';
  const card = (a: Artifact) => `
    <article class="wcard">
      <div class="wcard-top" style="--tc:${TYPE_COLOR[a.type]}">
        <span class="wcard-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TYPE_SVG[a.type]}</svg></span>
        ${a.agent ? '<span class="wcard-agent">✦ by agent</span>' : ''}
      </div>
      <div class="wcard-body">
        <div class="wcard-name">${a.name}</div>
        <div class="wcard-meta">
          <span class="wtype" style="--tc:${TYPE_COLOR[a.type]}">${a.type}</span>
          <span class="wvis ${visClass(a.vis)}">${a.vis}</span>
          <span class="wviews"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>${a.views}</span>
        </div>
      </div>
    </article>`;

  const navItem = (label: string, active = false, count?: string) => `
    <a class="wnav-item${active ? ' active' : ''}">
      <span>${label}</span>${count ? `<span class="wnav-count">${count}</span>` : ''}
    </a>`;

  const body = `<div class="wsp">
  <header class="wsp-top">
    <div class="wsp-brand">${brandLockupHtml({ markSize: 26 })}</div>
    <div class="wsp-host"><span class="wsp-dot"></span>${host}</div>
    <div class="wsp-reserved">Reserved for you</div>
  </header>

  <div class="wsp-banner">
    <div class="wsp-banner-text">
      <div class="wsp-banner-h">This is <b>${title}</b>’s home on ShareOut.</div>
      <div class="wsp-banner-p">Every dashboard, deck, doc and tool your team makes — organized, private, and live. Agents help build and keep it tidy.</div>
    </div>
    <div class="wsp-banner-actions">
      <button class="wsp-tour-btn" id="startTour" type="button"><span class="wsp-tour-play">▶</span> Take the tour</button>
      <a class="wsp-cta" id="makeReal" href="/home">Make it real <span class="arrow">→</span></a>
    </div>
  </div>

  <div class="wsp-shell">
    <aside class="wsp-side">
      <div class="wsp-ws">
        <div class="wsp-ws-mark">${title.charAt(0)}</div>
        <div class="wsp-ws-name">${title}<span>${host}</span></div>
      </div>
      <nav class="wsp-nav">
        ${navItem('All artifacts', true, '1,284')}
        ${navItem('Shared with me')}
        ${navItem('Favorites')}
        ${navItem('Agents', false, '6')}
      </nav>
      <div class="wsp-nav-title">Teams</div>
      <nav class="wsp-nav" id="wspTeams">
        ${TEAMS.map((t) => navItem(t)).join('')}
      </nav>
      <div class="wsp-priv" id="wspPriv">🔒 Private by default. You choose what leaves the room.</div>
    </aside>

    <main class="wsp-main">
      <div class="wsp-main-head">
        <div class="wsp-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <span>Search ${title}…</span>
        </div>
        <div class="wsp-stats">
          <div class="wsp-stat"><b>1,284</b><span>artifacts</span></div>
          <div class="wsp-stat"><b>48</b><span>members</span></div>
          <div class="wsp-stat"><b>92k</b><span>views</span></div>
        </div>
      </div>
      <div class="wsp-grid">
        ${ARTIFACTS.map(card).join('')}
      </div>
    </main>
  </div>

  <div class="wsp-foot">
    <div class="wsp-foot-text"><b>${host}</b> is yours the moment you create the workspace.</div>
    <div class="wsp-foot-actions">
      <a class="wsp-foot-ghost" href="/">← Back</a>
      <a class="wsp-cta" href="/home">Create this workspace <span class="arrow">→</span></a>
    </div>
  </div>
</div>

<div class="tour-veil" id="tourVeil" hidden></div>
<div class="tour-pop" id="tourPop" hidden role="dialog" aria-live="polite">
  <div class="tour-pop-step"><span id="tourStep">1</span> / <span id="tourTotal">5</span></div>
  <div class="tour-pop-title" id="tourTitle"></div>
  <div class="tour-pop-text" id="tourText"></div>
  <div class="tour-pop-foot">
    <button class="tour-skip" id="tourSkip" type="button">Skip tour</button>
    <div class="tour-pop-nav">
      <button class="tour-prev" id="tourPrev" type="button">Back</button>
      <button class="tour-next" id="tourNext" type="button">Next <span class="arrow">→</span></button>
    </div>
  </div>
</div>
<script>window.__SO_WS=${JSON.stringify({ slug })};</script>`;

  const tourName = title.replace(/'/g, "\\'");
  const scripts = `(function(){
  function track(ev, extra){
    var p = JSON.stringify(Object.assign({ event: ev, mode: 'business' }, extra || {}));
    try { if(navigator.sendBeacon){ navigator.sendBeacon('/v1/funnel', new Blob([p], { type: 'application/json' })); return; } } catch(e){}
    try { fetch('/v1/funnel', { method:'POST', headers:{'Content-Type':'application/json'}, body:p, keepalive:true }); } catch(e){}
  }
  track('teams_preview', { label: (window.__SO_WS && window.__SO_WS.slug) || '' });

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var NAME = '${tourName}';

  /* entrance — the workspace populates in */
  var wsp = document.querySelector('.wsp');
  if(wsp){ if(reduce){ wsp.classList.add('loaded','no-anim'); } else { requestAnimationFrame(function(){ wsp.classList.add('loaded'); }); } }

  /* ---------------- guided product tour ---------------- */
  var STEPS = [
    { sel: '#wspPriv', title: 'Private by default', text: 'Nothing is public until you say so. ' + NAME + ' decides exactly what leaves the room.' },
    { sel: '.wcard-agent', up: '.wcard', title: 'Agents build alongside you', text: 'These were built and kept tidy by agents — through your own endpoints, on your terms.' },
    { sel: '#wspTeams', title: 'Organized by team', text: 'Every dashboard, deck and doc lands with the right team. Found in a keystroke, never trapped in a folder.' },
    { sel: '.wvis.shared', up: '.wcard', title: 'Share beyond your walls', text: 'Share any artifact with clients or partners — with approval flows when you need them. No seat limits.' },
    { sel: '#makeReal', title: 'Make it yours', text: 'This whole home is reserved for ' + NAME + '. Pick a plan and it goes live.' }
  ];
  var veil = document.getElementById('tourVeil'), pop = document.getElementById('tourPop');
  var elStep = document.getElementById('tourStep'), elTotal = document.getElementById('tourTotal');
  var elTitle = document.getElementById('tourTitle'), elText = document.getElementById('tourText');
  var prevBtn = document.getElementById('tourPrev'), nextBtn = document.getElementById('tourNext');
  var skipBtn = document.getElementById('tourSkip'), startBtn = document.getElementById('startTour');
  var idx = -1, current = null, steps = [];

  function resolve(){
    steps = [];
    STEPS.forEach(function(s){
      var el = document.querySelector(s.sel);
      if(el && s.up) el = el.closest(s.up) || el;
      if(el && el.offsetParent !== null) steps.push({ title: s.title, text: s.text, el: el });
    });
  }
  function clearSpot(){ if(current){ current.classList.remove('tour-spot'); current = null; } }
  function place(){
    if(!current || pop.hidden) return;
    var r = current.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight, m = 16, vw = window.innerWidth, vh = window.innerHeight;
    var top = r.bottom + m, left = r.left;
    if(top + ph > vh - 12) top = Math.max(12, r.top - ph - m);
    if(left + pw > vw - 12) left = vw - pw - 12;
    if(left < 12) left = 12;
    pop.style.top = top + 'px'; pop.style.left = left + 'px';
  }
  function show(i){
    if(i < 0 || i >= steps.length){ end(false); return; }
    clearSpot();
    idx = i; var s = steps[i]; current = s.el;
    current.classList.add('tour-spot');
    try { current.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); } catch(e){ current.scrollIntoView(); }
    elStep.textContent = String(i + 1); elTotal.textContent = String(steps.length);
    elTitle.textContent = s.title; elText.textContent = s.text;
    prevBtn.style.visibility = i === 0 ? 'hidden' : 'visible';
    nextBtn.innerHTML = i === steps.length - 1 ? 'Make it real <span class="arrow">\\u2192</span>' : 'Next <span class="arrow">\\u2192</span>';
    veil.hidden = false; pop.hidden = false;
    setTimeout(place, reduce ? 0 : 340);
  }
  function start(){ resolve(); if(!steps.length) return; track('teams_tour_start'); document.body.classList.add('tour-on'); show(0); }
  function end(go){ clearSpot(); veil.hidden = true; pop.hidden = true; document.body.classList.remove('tour-on'); track('teams_tour_end', { step: idx + 1 }); idx = -1; if(go){ var mk = document.getElementById('makeReal'); if(mk) window.location.assign(mk.getAttribute('href')); } }

  if(nextBtn) nextBtn.addEventListener('click', function(){ if(idx === steps.length - 1) end(true); else show(idx + 1); });
  if(prevBtn) prevBtn.addEventListener('click', function(){ show(idx - 1); });
  if(skipBtn) skipBtn.addEventListener('click', function(){ end(false); });
  if(veil) veil.addEventListener('click', function(){ end(false); });
  if(startBtn) startBtn.addEventListener('click', start);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  document.addEventListener('keydown', function(e){ if(pop.hidden) return; if(e.key === 'Escape') end(false); else if(e.key === 'ArrowRight'){ (idx === steps.length - 1) ? end(true) : show(idx + 1); } else if(e.key === 'ArrowLeft') show(idx - 1); });

  /* auto-start once per browser, after entrance settles */
  var seen = null; try { seen = localStorage.getItem('so_teams_tour'); } catch(e){}
  if(!seen && !reduce){ setTimeout(function(){ try { localStorage.setItem('so_teams_tour', '1'); } catch(e){} start(); }, 950); }
})();`;

  return renderHtmlPage({
    title: `${title} on ShareOut — your team's home`,
    description: `${host} — every dashboard, deck, doc and tool your team makes, organized, private and live. Reserve your workspace on ShareOut.`,
    pageStyles: teamsPreviewStyles,
    body,
    scripts,
    cacheControl: 'private, no-cache',
  });
}

const teamsPreviewStyles = `
html, body { height: 100%; }
body { overflow-x: hidden; background: var(--color-bg); color: var(--color-text); font-family: var(--font-body); }

.wsp { min-height: 100vh; display: flex; flex-direction: column; }

/* top */
.wsp-top { display: flex; align-items: center; gap: 16px; padding: 14px 24px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-elevated); }
.wsp-brand { display: flex; align-items: center; }
.wsp-brand .brand { font: 700 1.05rem var(--font-display); color: var(--color-text); display: inline-flex; align-items: center; gap: 8px; }
.wsp-brand .brand-mark { width: 26px; height: 26px; }
.wsp-host { margin-left: 8px; display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: var(--radius-full); background: var(--color-surface); border: 1px solid var(--color-border); font: 500 0.85rem var(--font-mono); color: var(--color-text-secondary); }
.wsp-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-success); }
.wsp-reserved { margin-left: auto; padding: 7px 14px; border-radius: var(--radius-full); background: var(--color-primary-light); color: var(--color-primary); font: 600 0.8rem var(--font-body); }

/* banner */
.wsp-banner { display: flex; align-items: center; gap: 24px; padding: 22px 24px; }
.wsp-banner-text { flex: 1; min-width: 0; }
.wsp-banner-h { font: 700 1.5rem var(--font-display); letter-spacing: -0.02em; color: var(--color-text); }
.wsp-banner-h b { color: var(--color-primary); }
.wsp-banner-p { margin-top: 5px; font: 400 1rem var(--font-body); color: var(--color-text-secondary); max-width: 60ch; }
.wsp-cta { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 9px; padding: 14px 26px; border-radius: var(--radius-full); background: var(--color-primary); color: var(--color-text-inverse); font: 600 1.02rem var(--font-body); box-shadow: 0 14px 30px -8px var(--color-primary-glow); transition: transform .12s var(--ease-out), background .15s var(--ease-out); white-space: nowrap; }
.wsp-cta:hover { background: var(--color-primary-hover); transform: translateY(-2px); }
.wsp-cta .arrow { transition: transform .15s var(--ease-out); }
.wsp-cta:hover .arrow { transform: translateX(4px); }

/* shell */
.wsp-shell { flex: 1; display: grid; grid-template-columns: 248px 1fr; gap: 20px; padding: 0 24px 120px; max-width: 1280px; width: 100%; margin: 0 auto; }

.wsp-side { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }
.wsp-ws { display: flex; align-items: center; gap: 11px; padding: 10px 12px; margin-bottom: 8px; border-radius: var(--radius-lg); background: var(--color-bg-elevated); border: 1px solid var(--color-border); }
.wsp-ws-mark { width: 36px; height: 36px; border-radius: 9px; background: var(--color-primary); color: #fff; display: inline-flex; align-items: center; justify-content: center; font: 700 1.05rem var(--font-display); }
.wsp-ws-name { font: 700 0.96rem var(--font-display); color: var(--color-text); line-height: 1.2; }
.wsp-ws-name span { display: block; font: 400 0.72rem var(--font-mono); color: var(--color-text-tertiary); }
.wsp-nav { display: flex; flex-direction: column; gap: 2px; }
.wsp-nav-title { margin: 14px 12px 6px; font: 600 0.7rem var(--font-body); letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-tertiary); }
.wnav-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: var(--radius-md); font: 500 0.9rem var(--font-body); color: var(--color-text-secondary); cursor: default; }
.wnav-item span:first-child { flex: 1; }
.wnav-item.active { background: var(--color-primary-light); color: var(--color-primary); font-weight: 600; }
.wnav-item:not(.active):hover { background: var(--color-surface); }
.wnav-count { font: 500 0.78rem var(--font-body); color: var(--color-text-tertiary); }
.wnav-item.active .wnav-count { color: var(--color-primary); }
.wsp-priv { margin-top: 16px; padding: 12px 14px; border-radius: var(--radius-md); background: var(--color-surface); font: 500 0.8rem var(--font-body); color: var(--color-text-secondary); line-height: 1.4; }

.wsp-main { min-width: 0; }
.wsp-main-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 4px 0 18px; flex-wrap: wrap; }
.wsp-search { display: inline-flex; align-items: center; gap: 10px; padding: 11px 16px; border-radius: var(--radius-full); background: var(--color-bg-elevated); border: 1px solid var(--color-border); color: var(--color-text-tertiary); font: 500 0.9rem var(--font-body); min-width: 260px; }
.wsp-search svg { width: 18px; height: 18px; }
.wsp-stats { display: flex; gap: 22px; }
.wsp-stat { text-align: right; }
.wsp-stat b { display: block; font: 700 1.2rem var(--font-display); color: var(--color-text); }
.wsp-stat span { font: 500 0.72rem var(--font-body); color: var(--color-text-tertiary); }

.wsp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
.wcard { border-radius: var(--radius-lg); background: var(--color-bg-elevated); border: 1px solid var(--color-border); overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: transform .12s var(--ease-out), box-shadow .15s var(--ease-out), border-color .15s var(--ease-out); }
.wcard:hover { transform: translateY(-2px); box-shadow: 0 8px 20px -8px rgba(28,25,23,0.16); border-color: var(--color-border-strong); }
.wcard-top { position: relative; height: 84px; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--tc) 10%, #ffffff); border-bottom: 1px solid var(--color-border); }
.wcard-ic { width: 40px; height: 40px; border-radius: 11px; background: #fff; border: 1px solid var(--color-border); display: inline-flex; align-items: center; justify-content: center; color: var(--tc); }
.wcard-ic svg { width: 21px; height: 21px; }
.wcard-agent { position: absolute; top: 8px; right: 8px; padding: 3px 8px; border-radius: var(--radius-full); background: rgba(255,255,255,0.85); font: 600 0.64rem var(--font-body); color: var(--color-primary); }
.wcard-body { padding: 13px 14px 14px; }
.wcard-name { font: 600 0.95rem var(--font-body); color: var(--color-text); margin-bottom: 9px; }
.wcard-meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.wtype { padding: 3px 9px; border-radius: var(--radius-full); background: color-mix(in srgb, var(--tc) 12%, #ffffff); color: var(--tc); font: 600 0.68rem var(--font-body); }
.wvis { padding: 3px 9px; border-radius: var(--radius-full); font: 600 0.68rem var(--font-body); }
.wvis.priv { background: var(--color-surface); color: var(--color-text-secondary); }
.wvis.shared { background: var(--color-warning-light); color: var(--color-warning); }
.wvis.pub { background: var(--color-success-light); color: var(--color-success); }
.wviews { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; font: 500 0.74rem var(--font-body); color: var(--color-text-tertiary); }
.wviews svg { width: 13px; height: 13px; }

/* sticky bottom CTA */
.wsp-foot { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; display: flex; align-items: center; justify-content: center; gap: 20px; padding: 16px 24px; background: rgba(255,255,255,0.82); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-top: 1px solid var(--color-border); }
.wsp-foot-text { font: 500 0.95rem var(--font-body); color: var(--color-text-secondary); }
.wsp-foot-text b { color: var(--color-text); font-family: var(--font-mono); font-weight: 600; }
.wsp-foot-actions { display: inline-flex; align-items: center; gap: 14px; }
.wsp-foot-ghost { font: 600 0.9rem var(--font-body); color: var(--color-text-secondary); }
.wsp-foot-ghost:hover { color: var(--color-text); }

/* banner actions */
.wsp-banner-actions { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 12px; }
.wsp-tour-btn { display: inline-flex; align-items: center; gap: 8px; padding: 13px 20px; border-radius: var(--radius-full); background: var(--color-bg-elevated); border: 1px solid var(--color-border-strong); color: var(--color-text); font: 600 0.98rem var(--font-body); cursor: pointer; transition: background .15s var(--ease-out), border-color .15s var(--ease-out); }
.wsp-tour-btn:hover { background: var(--color-surface); border-color: var(--color-text-tertiary); }
.wsp-tour-play { color: var(--color-primary); font-size: 0.78rem; }

/* entrance — the workspace populates in */
@keyframes wspRise { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: none; } }
.wsp.loaded:not(.no-anim) .wsp-banner { animation: wspRise .5s var(--ease-out) both; }
.wsp.loaded:not(.no-anim) .wsp-side { animation: wspRise .5s .06s var(--ease-out) both; }
.wsp.loaded:not(.no-anim) .wsp-main-head { animation: wspRise .5s .08s var(--ease-out) both; }
.wsp.loaded:not(.no-anim) .wcard { animation: wspRise .46s var(--ease-out) both; }
${ARTIFACTS.map((_, i) => `.wsp.loaded:not(.no-anim) .wcard:nth-child(${i + 1}){animation-delay:${(0.12 + i * 0.03).toFixed(2)}s}`).join('\n')}

/* guided tour overlay */
.tour-veil { position: fixed; inset: 0; z-index: 79; background: transparent; }
.tour-spot { position: relative; z-index: 82; border-radius: var(--radius-lg); box-shadow: 0 0 0 4px var(--color-primary), 0 0 0 9999px rgba(20, 18, 16, 0.55); transition: box-shadow .3s var(--ease-out); }
.tour-pop { position: fixed; z-index: 90; width: min(320px, calc(100vw - 24px)); padding: 18px 18px 14px; border-radius: var(--radius-lg); background: var(--color-bg-elevated); border: 1px solid var(--color-border); box-shadow: 0 24px 60px -18px rgba(28, 25, 23, 0.5); }
.tour-pop-step { font: 600 0.72rem var(--font-mono); color: var(--color-primary); letter-spacing: 0.04em; }
.tour-pop-title { margin-top: 6px; font: 700 1.1rem var(--font-display); letter-spacing: -0.02em; color: var(--color-text); }
.tour-pop-text { margin-top: 7px; font: 400 0.92rem / 1.5 var(--font-body); color: var(--color-text-secondary); }
.tour-pop-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; }
.tour-skip { background: none; border: none; cursor: pointer; font: 600 0.84rem var(--font-body); color: var(--color-text-tertiary); }
.tour-skip:hover { color: var(--color-text-secondary); }
.tour-pop-nav { display: inline-flex; align-items: center; gap: 8px; }
.tour-prev { background: none; border: none; cursor: pointer; padding: 9px 12px; border-radius: var(--radius-full); font: 600 0.86rem var(--font-body); color: var(--color-text-secondary); }
.tour-prev:hover { background: var(--color-surface); }
.tour-next { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: var(--radius-full); border: none; cursor: pointer; background: var(--color-primary); color: var(--color-text-inverse); font: 600 0.88rem var(--font-body); box-shadow: 0 8px 18px -6px var(--color-primary-glow); }
.tour-next:hover { background: var(--color-primary-hover); }
.tour-next .arrow, .wsp-cta .arrow { transition: transform .15s var(--ease-out); }
.tour-next:hover .arrow { transform: translateX(3px); }

@media (max-width: 860px) {
  .wsp-shell { grid-template-columns: 1fr; padding-bottom: 168px; }
  .wsp-side { display: none; }
  .wsp-banner { flex-direction: column; align-items: flex-start; }
  .wsp-banner-actions { width: 100%; }
  .wsp-foot { flex-direction: column; gap: 12px; text-align: center; }
}
@media (max-width: 640px) {
  .wsp-top {
    flex-wrap: wrap;
    gap: 10px;
    padding: calc(12px + env(safe-area-inset-top)) 16px 12px;
  }
  .wsp-brand { flex: 1 1 auto; min-width: 0; }
  .wsp-brand .brand { font-size: 0.98rem; }
  .wsp-host {
    order: 3;
    flex: 1 1 100%;
    margin-left: 0;
    min-width: 0;
    justify-content: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wsp-reserved { margin-left: 0; padding: 6px 11px; font-size: 0.74rem; }

  .wsp-banner {
    gap: 18px;
    padding: 22px 16px 18px;
  }
  .wsp-banner-h { font-size: clamp(1.35rem, 7vw, 1.8rem); line-height: 1.08; }
  .wsp-banner-p { font-size: 0.94rem; line-height: 1.5; }
  .wsp-banner-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .wsp-tour-btn,
  .wsp-cta {
    width: 100%;
    justify-content: center;
    min-height: 48px;
  }

  .wsp-shell {
    gap: 14px;
    padding: 0 16px 188px;
  }
  .wsp-main-head {
    align-items: stretch;
    gap: 12px;
    padding-bottom: 14px;
  }
  .wsp-search {
    width: 100%;
    min-width: 0;
    border-radius: var(--radius-lg);
  }
  .wsp-stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    width: 100%;
  }
  .wsp-stat {
    text-align: center;
    padding: 10px 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg-elevated);
  }
  .wsp-stat b { font-size: 1rem; }
  .wsp-stat span { font-size: 0.66rem; }

  .wsp-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .wcard {
    display: grid;
    grid-template-columns: 74px 1fr;
  }
  .wcard-top {
    height: auto;
    min-height: 86px;
    border-bottom: none;
    border-right: 1px solid var(--color-border);
  }
  .wcard-agent {
    left: 8px;
    right: 8px;
    top: auto;
    bottom: 8px;
    text-align: center;
  }
  .wcard-body {
    min-width: 0;
    padding: 13px 12px;
  }
  .wcard-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wcard-meta { gap: 6px; }
  .wviews { margin-left: 0; }

  .wsp-foot {
    align-items: stretch;
    padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
  }
  .wsp-foot-text {
    font-size: 0.86rem;
    line-height: 1.35;
  }
  .wsp-foot-actions {
    display: grid;
    grid-template-columns: 0.75fr 1.25fr;
    gap: 10px;
    width: 100%;
  }
  .wsp-foot-ghost,
  .wsp-foot .wsp-cta {
    justify-content: center;
    width: 100%;
  }

  .tour-pop {
    left: 12px !important;
    right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom));
    top: auto !important;
    width: auto;
  }
  .tour-pop-foot {
    align-items: stretch;
    flex-direction: column;
  }
  .tour-pop-nav {
    display: grid;
    grid-template-columns: 0.8fr 1.2fr;
    width: 100%;
  }
  .tour-prev,
  .tour-next,
  .tour-skip {
    justify-content: center;
    min-height: 44px;
  }
}
@media (max-width: 380px) {
  .wsp-brand .brand-name { display: none; }
  .wsp-reserved { font-size: 0.7rem; }
  .wsp-stat { padding: 8px 5px; }
  .wsp-foot-text { display: none; }
  .wsp-foot-actions { grid-template-columns: 1fr; }
  .wcard { grid-template-columns: 64px 1fr; }
  .wcard-top { min-height: 82px; }
  .wcard-ic { width: 34px; height: 34px; }
  .wcard-agent { font-size: 0.56rem; padding-inline: 4px; }
}
@media (prefers-reduced-motion: reduce) {
  .wcard, .wsp-cta { transition: none; }
  .wsp .wcard, .wsp-banner, .wsp-side, .wsp-main-head { animation: none !important; }
  .tour-spot { transition: none; }
}
`;
