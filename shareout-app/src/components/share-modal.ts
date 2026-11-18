import { colors, fonts, radius, shadows } from '../../packages/design-tokens/src/index';
import type { Locale, LocaleCopy } from '../i18n';

type ShareKey =
  | 'share' | 'shareQuoted' | 'close' | 'loading' | 'addPh' | 'invite' | 'inviteHint' | 'inviteRow' | 'addMsg' | 'msgPh'
  | 'people' | 'owner' | 'canView' | 'canEdit' | 'remove' | 'pending'
  | 'general' | 'generalRo' | 'visPrivate' | 'visWorkspace' | 'visPublic' | 'subPrivate' | 'subWorkspace' | 'subPublic' | 'wsFallback'
  | 'copy' | 'done' | 'copiedPrivate' | 'copiedWorkspace' | 'copiedPublic'
  | 'added' | 'addedMany' | 'addedNoMail' | 'addedLimit' | 'already' | 'addFailed' | 'badEmail'
  | 'visFailed' | 'roleFailed' | 'removeFailed'
  | 'sendLink' | 'sendPh' | 'send' | 'sent' | 'sendFailed' | 'viewerNote' | 'ownerFallback';

// Rendered with textContent / escaped at run time; {name} {email} {n} {ws} {owner} are filled in.
const SHARE_COPY: LocaleCopy<Record<ShareKey, string>> = {
  en: {
    share: 'Share', shareQuoted: 'Share “{name}”', close: 'Close', loading: 'Loading…',
    addPh: 'Add people by name or email', invite: 'Invite',
    inviteHint: 'They get an email with the link and sign in with a code we send them — no password.',
    inviteRow: 'Invite {email}', addMsg: '+ Add a message', msgPh: 'Write a short note (optional)',
    people: 'People with access', owner: 'Owner', canView: 'Can view', canEdit: 'Can edit', remove: 'Remove access',
    pending: 'Invited · hasn’t signed in yet',
    general: 'Who else can open it', generalRo: 'Who can open it',
    visPrivate: 'Only the people above', visWorkspace: 'Everyone in {ws}', visPublic: 'Anyone with the link',
    subPrivate: 'Nobody else can open it, even with the link.',
    subWorkspace: 'Anyone in {ws} who signs in can open it.',
    subPublic: 'Anyone with the link can open it, no sign-in needed.',
    wsFallback: 'your workspace',
    copy: 'Copy link', done: 'Done',
    copiedPrivate: 'Link copied. Only the people with access can open it.',
    copiedWorkspace: 'Link copied. Anyone in {ws} who signs in can open it.',
    copiedPublic: 'Link copied.',
    added: '{email} can see it now. We emailed them the link.',
    addedMany: '{n} people can see it now. We emailed them the link.',
    addedNoMail: '{email} has access, but the email didn’t go out. Copy the link and send it to them.',
    addedLimit: 'They have access, but you hit today’s email limit. Copy the link and send it to them.',
    already: '{email} already had access.',
    addFailed: 'Couldn’t invite. Try again.', badEmail: 'That doesn’t look like an email.',
    visFailed: 'Couldn’t change who can open it.', roleFailed: 'Couldn’t change their access.', removeFailed: 'Couldn’t remove their access.',
    sendLink: 'Email the link', sendPh: 'name@company.com', send: 'Send',
    sent: 'We sent the link to {email}.', sendFailed: 'Couldn’t send the link.',
    viewerNote: 'Only people with access can open it. To add someone, ask {owner}.', ownerFallback: 'its owner',
  },
  es: {
    share: 'Compartir', shareQuoted: 'Compartir “{name}”', close: 'Cerrar', loading: 'Cargando…',
    addPh: 'Agregá personas por nombre o mail', invite: 'Invitar',
    inviteHint: 'Le llega un mail con el link y entra con un código que le mandamos, sin contraseña.',
    inviteRow: 'Invitar a {email}', addMsg: '+ Agregar un mensaje', msgPh: 'Escribí una nota corta (opcional)',
    people: 'Personas con acceso', owner: 'Dueño', canView: 'Puede ver', canEdit: 'Puede editar', remove: 'Quitar acceso',
    pending: 'Invitado · todavía no entró',
    general: 'Quién más puede abrirlo', generalRo: 'Quién puede abrirlo',
    visPrivate: 'Solo las personas de arriba', visWorkspace: 'Todos en {ws}', visPublic: 'Cualquiera con el link',
    subPrivate: 'Nadie más puede abrirlo, aunque tenga el link.',
    subWorkspace: 'Cualquiera de {ws} que inicie sesión puede abrirlo.',
    subPublic: 'Lo abre cualquiera con el link, sin iniciar sesión.',
    wsFallback: 'tu espacio',
    copy: 'Copiar enlace', done: 'Listo',
    copiedPrivate: 'Link copiado. Solo lo abren las personas con acceso.',
    copiedWorkspace: 'Link copiado. Lo abre cualquiera de {ws} que inicie sesión.',
    copiedPublic: 'Link copiado.',
    added: '{email} ya puede verlo. Le mandamos el link por mail.',
    addedMany: '{n} personas ya pueden verlo. Les mandamos el link por mail.',
    addedNoMail: '{email} ya tiene acceso, pero el mail no salió. Copiá el link y mandáselo.',
    addedLimit: 'Ya tienen acceso, pero llegaste al límite de mails de hoy. Copiá el link y mandáselo.',
    already: '{email} ya tenía acceso.',
    addFailed: 'No pudimos invitar. Probá de nuevo.', badEmail: 'Eso no parece un mail.',
    visFailed: 'No pudimos cambiar quién puede abrirlo.', roleFailed: 'No pudimos cambiar su acceso.', removeFailed: 'No pudimos quitar su acceso.',
    sendLink: 'Mandar el link por mail', sendPh: 'nombre@empresa.com', send: 'Enviar',
    sent: 'Le mandamos el link a {email}.', sendFailed: 'No pudimos mandar el link.',
    viewerNote: 'Solo lo abren quienes ya tienen acceso. Para sumar a alguien, pedíselo a {owner}.', ownerFallback: 'quien lo creó',
  },
};

const SHARE_CSS = `
#soShareOverlay{display:none;position:fixed;inset:0;z-index:10001;align-items:center;justify-content:center;font-family:${fonts.body};color:${colors.text};}
#soShareOverlay.is-open{display:flex;}
#soShareOverlay *{box-sizing:border-box;}
#soShareOverlay .so-sh-backdrop{position:absolute;inset:0;background:rgba(28,25,23,0.45);}
#soShareOverlay .so-sh-panel{position:relative;width:min(460px,calc(100vw - 24px));max-height:calc(100vh - 32px);overflow:auto;background:${colors.bgElevated};border:1px solid ${colors.border};border-radius:${radius.lg};box-shadow:${shadows.xl};padding:20px;display:flex;flex-direction:column;gap:14px;}
#soShareOverlay .so-sh-head{display:flex;align-items:center;gap:8px;}
#soShareOverlay h3{flex:1;min-width:0;margin:0;font-family:${fonts.display};font-weight:700;font-size:18px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#soShareOverlay .so-sh-x{width:32px;height:32px;border:0;border-radius:${radius.sm};background:transparent;color:${colors.textSecondary};font-size:20px;line-height:1;cursor:pointer;}
#soShareOverlay .so-sh-x:hover{background:${colors.surface};}
#soShareOverlay .so-sh-add{position:relative;display:flex;flex-direction:column;gap:6px;}
#soShareOverlay .so-sh-addrow{display:flex;gap:8px;}
#soShareOverlay input.so-sh-in,#soShareOverlay textarea.so-sh-msg{flex:1;min-width:0;width:100%;padding:10px 12px;border:1px solid ${colors.border};border-radius:${radius.sm};font:inherit;font-size:14px;color:${colors.text};background:${colors.bg};outline:none;}
#soShareOverlay input.so-sh-in:focus,#soShareOverlay textarea.so-sh-msg:focus{border-color:${colors.primary};}
#soShareOverlay textarea.so-sh-msg{display:none;resize:vertical;min-height:64px;}
#soShareOverlay textarea.so-sh-msg.is-on{display:block;}
#soShareOverlay .so-sh-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:${radius.sm};font:inherit;font-size:14px;font-weight:600;cursor:pointer;border:1px solid transparent;white-space:nowrap;}
#soShareOverlay .so-sh-btn svg{width:16px;height:16px;}
#soShareOverlay .so-sh-primary{background:${colors.primary};color:${colors.textInverse};}
#soShareOverlay .so-sh-primary:disabled{opacity:0.55;cursor:default;}
#soShareOverlay .so-sh-ghost{background:${colors.bgElevated};border-color:${colors.border};color:${colors.text};}
#soShareOverlay .so-sh-ghost:hover{background:${colors.surface};}
#soShareOverlay .so-sh-hint{font-size:12.5px;line-height:1.45;color:${colors.textTertiary};}
#soShareOverlay .so-sh-link{align-self:flex-start;padding:0;border:0;background:none;font:inherit;font-size:13px;font-weight:600;color:${colors.primary};cursor:pointer;}
#soShareOverlay .so-sh-status{font-size:13px;color:${colors.error};}
#soShareOverlay .so-sh-status:empty{display:none;}
#soShareOverlay .so-sh-sugg{display:none;position:absolute;left:0;right:0;top:44px;z-index:5;background:${colors.bgElevated};border:1px solid ${colors.border};border-radius:${radius.sm};box-shadow:${shadows.lg};max-height:220px;overflow:auto;}
#soShareOverlay .so-sh-sugg.is-open{display:block;}
#soShareOverlay .so-sh-opt{display:flex;align-items:center;gap:10px;width:100%;padding:8px 12px;border:0;background:transparent;text-align:left;font:inherit;font-size:14px;color:${colors.text};cursor:pointer;}
#soShareOverlay .so-sh-opt:hover,#soShareOverlay .so-sh-opt.is-active{background:${colors.surface};}
#soShareOverlay .so-sh-opt small{display:block;font-size:12px;color:${colors.textTertiary};}
#soShareOverlay .so-sh-sec{font-size:13px;font-weight:600;color:${colors.textSecondary};margin:4px 0 -4px;}
#soShareOverlay .so-sh-people{display:flex;flex-direction:column;max-height:min(288px,34vh);overflow-y:auto;padding-right:6px;margin-right:-6px;}
#soShareOverlay .so-sh-row{display:flex;align-items:center;gap:10px;padding:7px 0;}
#soShareOverlay .so-sh-av{flex:none;width:30px;height:30px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:${colors.primaryLight};color:${colors.primary};font-size:13px;font-weight:700;}
#soShareOverlay .so-sh-who{flex:1;min-width:0;}
#soShareOverlay .so-sh-em{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#soShareOverlay .so-sh-sub{font-size:12px;color:${colors.textTertiary};}
#soShareOverlay .so-sh-row .so-sh-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#soShareOverlay .so-sh-roletxt{font-size:13px;color:${colors.textSecondary};white-space:nowrap;}
#soShareOverlay select.so-sh-sel{appearance:none;-webkit-appearance:none;border:1px solid transparent;border-radius:${radius.sm};background:transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 8px center;padding:6px 26px 6px 8px;font:inherit;font-size:13px;color:${colors.textSecondary};cursor:pointer;}
#soShareOverlay select.so-sh-sel:hover,#soShareOverlay select.so-sh-sel:focus{border-color:${colors.border};background-color:${colors.surface};outline:none;}
#soShareOverlay .so-sh-rm{flex:none;width:28px;height:28px;border:0;border-radius:${radius.sm};background:transparent;color:${colors.textTertiary};font-size:18px;line-height:1;cursor:pointer;}
#soShareOverlay .so-sh-rm:hover{background:${colors.surface};color:${colors.text};}
#soShareOverlay .so-sh-gen{display:flex;align-items:flex-start;gap:10px;}
#soShareOverlay .so-sh-genic{flex:none;width:30px;height:30px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:${colors.surface};color:${colors.textSecondary};}
#soShareOverlay .so-sh-genic svg{width:16px;height:16px;}
#soShareOverlay .so-sh-gen select.so-sh-sel{margin-left:-8px;font-size:14px;font-weight:600;color:${colors.text};}
#soShareOverlay .so-sh-genname{font-size:14px;font-weight:600;padding:6px 0;}
#soShareOverlay .so-sh-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:4px;}
@media (max-width:520px){
#soShareOverlay{align-items:flex-end;}
#soShareOverlay .so-sh-panel{width:100vw;max-height:92vh;border-radius:16px 16px 0 0;border-width:1px 0 0;padding:18px 16px calc(16px + env(safe-area-inset-bottom));}
#soShareOverlay .so-sh-row{gap:8px;}
#soShareOverlay .so-sh-row select.so-sh-sel{padding-right:22px;background-position:right 6px center;}
}
`;

/**
 * The one share dialog: the home tab's Share button, its Details rail and the artifact
 * viewer's toolbar all open this. Self-contained — it injects its own styles and markup
 * on first open, reads the artifact itself (GET /v1/artifacts/:id) and defines
 * window.openShare(id, slug, name, canManage) / window.closeShare().
 *
 * People who can edit: add anyone by email (a workspace member, a teammate who has no
 * account yet, or someone outside) → viewer of this artifact only + an email with the
 * link (they sign in with a code); change or remove access; pick who else can open it.
 * Everyone else: copy the link or email it to people who already have access.
 * `locale` omitted = read window.WSX_LOCALE (the home's static bundle).
 * Fires `so:share-changed` on window ({ id, visibility }) after any change.
 */
export function shareModalScript(opts: { baseUrl: string; locale?: Locale | null }): string {
  return `(function(){
  if (window.openShare && window.openShare.soShare) return;
  var BASE=${JSON.stringify(opts.baseUrl || '')};
  var COPY=${JSON.stringify(SHARE_COPY)};
  var CSS=${JSON.stringify(SHARE_CSS)};
  var LOC=${JSON.stringify(opts.locale || null)}||window.WSX_LOCALE||((document.documentElement.getAttribute('lang')||'').toLowerCase().indexOf('es')===0?'es':'en');
  var C=COPY[LOC]||COPY.en;
  var EMAIL_RE=/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  var SVG_LINK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  var VIS_ICON={
    'private':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    workspace:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    'public':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
  };
  var S=null;          // { id, slug, name, manage, meta, people, members, vis }
  var opener=null, suggIdx=-1, suggItems=[];

  function $(id){return document.getElementById(id);}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fill(s,v){return String(s).replace(/\\{(\\w+)\\}/g,function(m,k){return v&&v[k]!=null?v[k]:m;});}
  function toast(msg,type){
    if(window.showToast){window.showToast(msg,type);return;}
    var el=document.createElement('div');el.textContent=msg;
    el.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1200;max-width:calc(100vw - 32px);background:${colors.text};color:${colors.textInverse};padding:10px 16px;border-radius:${radius.sm};font:600 13px system-ui,sans-serif;box-shadow:${shadows.lg};';
    document.body.appendChild(el);setTimeout(function(){el.remove();},3200);
  }
  function api(path,init){
    init=init||{};init.credentials='include';
    if(init.body){init.headers={'content-type':'application/json'};}
    return fetch(BASE+path,init).then(function(r){
      return r.json().catch(function(){return null;}).then(function(d){
        if(!r.ok){var e=new Error('http '+r.status);e.status=r.status;e.userMessage=d&&d.error;throw e;}
        return d||{};
      });
    });
  }
  function status(msg){var el=$('soShareStatus');if(el)el.textContent=msg||'';}
  function emit(st){try{window.dispatchEvent(new CustomEvent('so:share-changed',{detail:{id:st.id,visibility:st.vis}}));}catch(e){}}
  function wsName(){return (S.meta&&S.meta.workspace_name)||C.wsFallback;}
  function linkUrl(){
    var u=S.meta&&S.meta.url; if(u)return u;
    return (BASE||location.origin)+'/a/'+encodeURIComponent(S.slug||'')+'/';
  }

  function ensureDom(){
    if($('soShareOverlay'))return;
    var st=document.createElement('style');st.id='soShareStyle';st.textContent=CSS;document.head.appendChild(st);
    var ov=document.createElement('div');
    ov.id='soShareOverlay';ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-labelledby','soShareTitle');
    ov.innerHTML='<div class="so-sh-backdrop" data-sh="close"></div><div class="so-sh-panel">'
      +'<div class="so-sh-head"><h3 id="soShareTitle"></h3><button type="button" class="so-sh-x" data-sh="close" aria-label="'+esc(C.close)+'">\\u00D7</button></div>'
      +'<div id="soShareBody" style="display:flex;flex-direction:column;gap:14px"></div>'
      +'<div class="so-sh-foot"><button type="button" class="so-sh-btn so-sh-ghost" data-sh="copy">'+SVG_LINK+esc(C.copy)+'</button>'
      +'<button type="button" class="so-sh-btn so-sh-primary" data-sh="close">'+esc(C.done)+'</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click',onClick);
    ov.addEventListener('change',onChange);
    ov.addEventListener('input',function(e){if(e.target&&e.target.id==='soShareInput'){status('');renderSugg();}});
    ov.addEventListener('keydown',onKey);
  }

  // ---- general access ("Who else can open it") ----
  function visOptions(){
    var o=['private'];
    if(S.meta&&S.meta.workspace_id)o.push('workspace');
    // Never offer what can't happen: public only where this workspace/instance allows it.
    if(S.vis==='public'||(S.meta&&S.meta.can_open_public!==false&&S.manage))o.push('public');
    return o;
  }
  function visLabel(v){return fill(v==='workspace'?C.visWorkspace:v==='public'?C.visPublic:C.visPrivate,{ws:wsName()});}
  function visSub(v){return fill(v==='workspace'?C.subWorkspace:v==='public'?C.subPublic:C.subPrivate,{ws:wsName()});}
  function renderGeneral(){
    var box=$('soShareGen');if(!box)return;
    var v=S.vis||'private', opts=visOptions();
    var ctl=S.manage&&opts.length>1
      ?'<select id="soShareVis" class="so-sh-sel" aria-label="'+esc(C.general)+'">'+opts.map(function(o){return '<option value="'+o+'"'+(o===v?' selected':'')+'>'+esc(visLabel(o))+'</option>';}).join('')+'</select>'
      :'<div class="so-sh-genname">'+esc(visLabel(v))+'</div>';
    box.innerHTML='<span class="so-sh-genic">'+(VIS_ICON[v]||VIS_ICON['private'])+'</span><div style="flex:1;min-width:0">'+ctl+'<div class="so-sh-sub">'+esc(visSub(v))+'</div></div>';
    var sel=$('soShareVis'); if(sel)sel.value=v;
  }
  function setVis(next){
    var st=S, prev=st.vis; if(next===prev)return;
    st.vis=next;renderGeneral();
    api('/v1/artifacts/'+encodeURIComponent(st.id),{method:'PATCH',body:JSON.stringify({visibility:next})})
      .then(function(j){
        var applied=(j&&j.visibility)||next; if(applied==='unlisted')applied='public';
        if(st.meta)st.meta.visibility=applied;
        if(applied!==st.vis){st.vis=applied;if(S===st)renderGeneral();}
        if(j&&j.message)toast(j.message,'info');
        emit(st);
      })
      .catch(function(e){st.vis=prev;if(S===st)renderGeneral();toast((e&&e.userMessage)||C.visFailed,'error');});
  }

  // ---- people with access ----
  function renderPeople(){
    var box=$('soSharePeople');if(!box)return;
    var owner=S.meta&&S.meta.owner, ownerEmail=owner&&owner.email?String(owner.email).toLowerCase():'';
    var h='';
    if(owner&&(owner.name||owner.email)){
      var on=owner.name||owner.email;
      h+='<div class="so-sh-row"><span class="so-sh-av">'+esc(String(on)[0].toUpperCase())+'</span><div class="so-sh-who"><div class="so-sh-em">'+esc(on)+'</div>'
        +(owner.name&&owner.email?'<div class="so-sh-sub">'+esc(owner.email)+'</div>':'')+'</div><span class="so-sh-roletxt">'+esc(C.owner)+'</span></div>';
    }
    (S.people||[]).forEach(function(p){
      if(p.role==='owner'&&p.email===ownerEmail)return;
      var role=p.role==='owner'?'<span class="so-sh-roletxt">'+esc(C.owner)+'</span>'
        :S.manage?'<select class="so-sh-sel" data-role-for="'+esc(p.email)+'" aria-label="'+esc(p.email)+'"><option value="viewer"'+(p.role!=='editor'?' selected':'')+'>'+esc(C.canView)+'</option><option value="editor"'+(p.role==='editor'?' selected':'')+'>'+esc(C.canEdit)+'</option></select>'
        :'<span class="so-sh-roletxt">'+esc(p.role==='editor'?C.canEdit:C.canView)+'</span>';
      h+='<div class="so-sh-row" data-person="'+esc(p.email)+'"><span class="so-sh-av">'+esc((p.email[0]||'?').toUpperCase())+'</span><div class="so-sh-who"><div class="so-sh-em" title="'+esc(p.email)+'">'+esc(p.email)+'</div>'
        +(p.pending?'<div class="so-sh-sub">'+esc(C.pending)+'</div>':'')+'</div>'+role
        +(S.manage&&p.role!=='owner'?'<button type="button" class="so-sh-rm" data-rm="'+esc(p.email)+'" aria-label="'+esc(C.remove)+'" title="'+esc(C.remove)+'">\\u00D7</button>':'')+'</div>';
    });
    box.innerHTML=h;
    var sec=$('soSharePeopleSec'); if(sec)sec.style.display=h?'':'none';
  }

  // ---- add people ----
  function parseEmails(v){return String(v||'').split(/[\\s,;]+/).map(function(e){return e.trim().toLowerCase();}).filter(Boolean);}
  function closeSugg(){var b=$('soShareSugg');if(b){b.classList.remove('is-open');b.innerHTML='';}suggIdx=-1;suggItems=[];}
  function renderSugg(){
    var box=$('soShareSugg'), inp=$('soShareInput'); if(!box||!inp||!S.manage){return;}
    var q=inp.value.trim().toLowerCase();
    if(!q){closeSugg();return;}
    var taken={};(S.people||[]).forEach(function(p){taken[p.email]=1;});
    var matches=(S.members||[]).filter(function(m){
      if(!m.email||taken[m.email.toLowerCase()])return false;
      return m.email.toLowerCase().indexOf(q)>=0||(m.name&&m.name.toLowerCase().indexOf(q)>=0);
    }).slice(0,6).map(function(m){return {email:m.email.toLowerCase(),name:m.name||''};});
    if(EMAIL_RE.test(q)&&!taken[q]&&!matches.some(function(m){return m.email===q;}))matches.push({email:q,invite:true});
    suggItems=matches; suggIdx=matches.length?0:-1;
    if(!matches.length){closeSugg();return;}
    box.innerHTML=matches.map(function(m,i){
      return '<button type="button" class="so-sh-opt'+(i===suggIdx?' is-active':'')+'" data-pick="'+esc(m.email)+'"><span class="so-sh-av">'+(m.invite?'+':esc((m.name||m.email)[0].toUpperCase()))+'</span><span>'
        +(m.invite?esc(fill(C.inviteRow,{email:m.email})):esc(m.name||m.email)+(m.name?'<small>'+esc(m.email)+'</small>':''))+'</span></button>';
    }).join('');
    box.classList.add('is-open');
  }
  function inviteToast(d,list){
    var n=d&&d.notified, first=list[0];
    if(!n)return [fill(C.added,{email:first}),'success'];
    if(n.rate_limited)return [C.addedLimit,'warning'];
    if((n.failed||[]).length)return [fill(C.addedNoMail,{email:n.failed[0].email||first}),'warning'];
    var sent=n.sent||[];
    if(sent.length>1)return [fill(C.addedMany,{n:sent.length}),'success'];
    if(sent.length===1)return [fill(C.added,{email:sent[0]}),'success'];
    return [fill(C.already,{email:first}),'info'];
  }
  function invite(list){
    var inp=$('soShareInput'), msg=$('soShareMsg');
    if(!list.length)return;
    var bad=list.filter(function(e){return !EMAIL_RE.test(e);});
    if(bad.length){status(C.badEmail);return;}
    var st=S, message=msg&&msg.value.trim()?msg.value.trim():undefined;
    var prev=st.people.slice();
    list.forEach(function(e){if(!st.people.some(function(p){return p.email===e;}))st.people.unshift({email:e,role:'viewer',pending:true});});
    renderPeople(); closeSugg(); status(''); if(inp)inp.value='';
    api('/v1/artifacts/'+encodeURIComponent(st.id)+'/collaborators',{method:'POST',body:JSON.stringify({emails:list,role:'viewer',notify:true,message:message})})
      .then(function(d){
        if(d.collaborators)st.people=d.collaborators;
        if(S===st){renderPeople();if(msg){msg.value='';msg.classList.remove('is-on');var ml=document.querySelector('#soShareOverlay [data-sh="msg"]');if(ml)ml.style.display='';}}
        var t=inviteToast(d,list); toast(t[0],t[1]);
        emit(st);
      })
      .catch(function(e){
        st.people=prev; if(S!==st){toast((e&&e.userMessage)||C.addFailed,'error');return;}
        renderPeople();if(inp)inp.value=list.join(', ');status((e&&e.userMessage)||C.addFailed);
      });
  }
  function setRole(email,role,sel){
    var st=S, p=st.people.filter(function(x){return x.email===email;})[0]; if(!p)return;
    var prev=p.role; p.role=role;
    api('/v1/artifacts/'+encodeURIComponent(st.id)+'/collaborators',{method:'POST',body:JSON.stringify({emails:[email],role:role,notify:false})})
      .then(function(d){if(d.collaborators){st.people=d.collaborators;if(S===st)renderPeople();}emit(st);})
      .catch(function(e){p.role=prev;if(sel)sel.value=prev;toast((e&&e.userMessage)||C.roleFailed,'error');});
  }
  function removePerson(email){
    var st=S, prev=st.people.slice();
    st.people=st.people.filter(function(p){return p.email!==email;});renderPeople();
    api('/v1/artifacts/'+encodeURIComponent(st.id)+'/collaborators/'+encodeURIComponent(email),{method:'DELETE'})
      .then(function(d){if(d.collaborators){st.people=d.collaborators;if(S===st)renderPeople();}emit(st);})
      .catch(function(e){st.people=prev;if(S===st)renderPeople();toast((e&&e.userMessage)||C.removeFailed,'error');});
  }
  // Can't add people: email the link to someone (who must already have access to open it).
  function sendLink(){
    var inp=$('soShareInput'), list=parseEmails(inp&&inp.value);
    if(!list.length||list.some(function(e){return !EMAIL_RE.test(e);})){status(C.badEmail);return;}
    status(''); if(inp)inp.value='';
    var st=S;
    api('/v1/artifacts/'+encodeURIComponent(st.id)+'/share',{method:'POST',body:JSON.stringify({recipients:list,role:'none'})})
      .then(function(d){var s=d.sent||[];toast(s.length?fill(C.sent,{email:s.join(', ')}):C.sendFailed,s.length?'success':'error');})
      .catch(function(e){if(S!==st){toast((e&&e.userMessage)||C.sendFailed,'error');return;}if(inp)inp.value=list.join(', ');status((e&&e.userMessage)||C.sendFailed);});
  }
  function copyLink(){
    var url=linkUrl();
    var done=function(){toast(fill(S.vis==='workspace'?C.copiedWorkspace:S.vis==='public'?C.copiedPublic:C.copiedPrivate,{ws:wsName()}),'success');};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(done,function(){fallbackCopy(url);done();});}
    else{fallbackCopy(url);done();}
  }
  function fallbackCopy(v){var ta=document.createElement('textarea');ta.value=v;ta.style.cssText='position:fixed;opacity:0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(e){}ta.remove();}

  // ---- body ----
  function renderBody(){
    var body=$('soShareBody'); if(!body)return;
    $('soShareTitle').textContent=fill(C.shareQuoted,{name:(S.meta&&S.meta.name)||S.name||S.slug||''});
    var h='';
    if(S.manage){
      h+='<div class="so-sh-add"><div class="so-sh-addrow"><input id="soShareInput" class="so-sh-in" type="text" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="'+esc(C.addPh)+'" aria-label="'+esc(C.addPh)+'">'
        +'<button type="button" class="so-sh-btn so-sh-primary" data-sh="invite">'+esc(C.invite)+'</button></div>'
        +'<div class="so-sh-sugg" id="soShareSugg" role="listbox"></div>'
        +'<div class="so-sh-hint">'+esc(C.inviteHint)+'</div>'
        +'<button type="button" class="so-sh-link" data-sh="msg">'+esc(C.addMsg)+'</button>'
        +'<textarea id="soShareMsg" class="so-sh-msg" maxlength="1000" placeholder="'+esc(C.msgPh)+'"></textarea>'
        +'<div class="so-sh-status" id="soShareStatus" role="status"></div></div>'
        +'<div class="so-sh-sec" id="soSharePeopleSec">'+esc(C.people)+'</div><div class="so-sh-people" id="soSharePeople"></div>'
        +'<div class="so-sh-sec">'+esc(C.general)+'</div><div class="so-sh-gen" id="soShareGen"></div>';
    } else {
      var owner=S.meta&&S.meta.owner;
      h+='<div class="so-sh-sec">'+esc(C.generalRo)+'</div><div class="so-sh-gen" id="soShareGen"></div>'
        +'<div class="so-sh-sec">'+esc(C.sendLink)+'</div>'
        +'<div class="so-sh-add"><div class="so-sh-addrow"><input id="soShareInput" class="so-sh-in" type="text" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="'+esc(C.sendPh)+'" aria-label="'+esc(C.sendLink)+'">'
        +'<button type="button" class="so-sh-btn so-sh-primary" data-sh="sendlink">'+esc(C.send)+'</button></div>'
        +'<div class="so-sh-hint">'+esc(fill(C.viewerNote,{owner:(owner&&(owner.name||owner.email))||C.ownerFallback}))+'</div>'
        +'<div class="so-sh-status" id="soShareStatus" role="status"></div></div>';
    }
    body.innerHTML=h;
    renderPeople(); renderGeneral();
  }

  // ---- events ----
  function onClick(e){
    var t=e.target&&e.target.closest?e.target:null; if(!t)return;
    var pick=t.closest('[data-pick]'); if(pick){invite([pick.getAttribute('data-pick')]);var i=$('soShareInput');if(i)i.focus();return;}
    var rm=t.closest('[data-rm]'); if(rm){removePerson(rm.getAttribute('data-rm'));return;}
    var a=t.closest('[data-sh]'); if(!a)return;
    var act=a.getAttribute('data-sh');
    if(act==='close')window.closeShare();
    else if(act==='copy')copyLink();
    else if(act==='invite')invite(parseEmails(($('soShareInput')||{}).value));
    else if(act==='sendlink')sendLink();
    else if(act==='msg'){var m=$('soShareMsg');if(m){m.classList.add('is-on');a.style.display='none';m.focus();}}
  }
  function onChange(e){
    var t=e.target; if(!t)return;
    if(t.id==='soShareVis')setVis(t.value);
    else if(t.getAttribute&&t.getAttribute('data-role-for'))setRole(t.getAttribute('data-role-for'),t.value,t);
  }
  function onKey(e){
    if(!e.target||e.target.id!=='soShareInput')return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      if(!suggItems.length)return; e.preventDefault();
      suggIdx=(suggIdx+(e.key==='ArrowDown'?1:-1)+suggItems.length)%suggItems.length;
      var opts=document.querySelectorAll('#soShareSugg .so-sh-opt');
      for(var i=0;i<opts.length;i++)opts[i].classList.toggle('is-active',i===suggIdx);
    } else if(e.key==='Enter'){
      e.preventDefault();
      if(!S.manage){sendLink();return;}
      var typed=parseEmails(e.target.value);
      // A highlighted member wins over a half-typed name; a typed email list is invited as-is.
      if(suggIdx>=0&&suggItems[suggIdx]&&!(typed.length&&typed.every(function(x){return EMAIL_RE.test(x);})))invite([suggItems[suggIdx].email]);
      else invite(typed);
    } else if(e.key==='Escape'&&suggItems.length){e.preventDefault();e.stopPropagation();closeSugg();}
  }
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){var ov=$('soShareOverlay');if(ov&&ov.classList.contains('is-open'))window.closeShare();}
  });

  window.openShare=function(id,slug,name,canManage){
    if(!id)return;
    ensureDom();
    opener=document.activeElement;
    S={id:id,slug:slug||'',name:name||'',manage:!!canManage,meta:null,people:[],members:[],vis:'private'};
    var my=S;
    $('soShareTitle').textContent=fill(C.shareQuoted,{name:S.name||S.slug});
    $('soShareBody').innerHTML='<div class="so-sh-hint">'+esc(C.loading)+'</div>';
    $('soShareOverlay').classList.add('is-open');
    api('/v1/artifacts/'+encodeURIComponent(id)).then(function(meta){
      if(S!==my)return;
      S.meta=meta; S.manage=!!meta.can_edit; S.slug=meta.slug||S.slug;
      S.vis=meta.visibility==='unlisted'?'public':(meta.visibility||'private');
    }).catch(function(){}).then(function(){
      if(S!==my)return;
      renderBody();
      var inp=$('soShareInput');
      if(inp&&!(window.matchMedia&&window.matchMedia('(pointer: coarse)').matches))inp.focus();
      if(!S.manage)return;
      api('/v1/artifacts/'+encodeURIComponent(id)+'/collaborators').then(function(d){if(S===my){S.people=d.collaborators||[];renderPeople();}}).catch(function(){});
      var ws=S.meta&&S.meta.workspace_id;
      api(ws?'/v1/workspaces/'+encodeURIComponent(ws)+'/members':'/v1/data/'+encodeURIComponent(id)+'/comments/_people')
        .then(function(d){if(S===my)S.members=((ws?d.members:d.people)||[]).filter(function(m){return m&&m.email;});}).catch(function(){});
    });
  };
  window.openShare.soShare=true;
  window.closeShare=function(){
    var ov=$('soShareOverlay'); if(!ov||!ov.classList.contains('is-open'))return;
    ov.classList.remove('is-open'); closeSugg(); S=null;
    if(opener&&opener.focus){try{opener.focus();}catch(e){}} opener=null;
  };
})();`;
}
