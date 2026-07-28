import { colors, fonts, radius, shadows } from '../design-system/tokens';

/**
 * Self-contained share dialog shared by the home page and the artifact viewer.
 * `shareModalMarkup()` returns the overlay HTML (inline-styled so it needs no
 * page CSS); `shareModalScript()` returns the JS defining window.openShare /
 * closeShare / submitShare. Both server-rendered surfaces inline these.
 */
export function shareModalMarkup(): string {
  return `<div id="soShareOverlay" role="dialog" aria-modal="true" aria-labelledby="soShareTitle" style="display:none;position:fixed;inset:0;z-index:1100;align-items:center;justify-content:center;">
  <style>
    #soShareOverlay .so-share-backdrop{position:absolute;inset:0;background:rgba(28,25,23,0.45);}
    #soShareOverlay .so-share-panel{position:relative;width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;background:${colors.bgElevated};border:1px solid ${colors.border};border-radius:${radius.lg};box-shadow:${shadows.xl};font-family:${fonts.body};color:${colors.text};padding:24px;}
    #soShareOverlay h3{margin:0 0 16px;font-family:${fonts.display};font-weight:700;font-size:18px;color:${colors.text};}
    #soShareOverlay label{display:block;font-size:13px;font-weight:600;color:${colors.textSecondary};margin:0 0 6px;}
    #soShareOverlay .so-field{margin-bottom:16px;}
    #soShareOverlay input[type=text],#soShareOverlay input[type=email],#soShareOverlay textarea{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid ${colors.border};border-radius:${radius.sm};font:inherit;font-size:14px;color:${colors.text};background:${colors.bg};}
    #soShareOverlay textarea{resize:vertical;min-height:60px;}
    #soShareOverlay .so-link-row{display:flex;gap:8px;}
    #soShareOverlay .so-link-row input{flex:1;}
    #soShareOverlay .so-seg{display:flex;gap:3px;background:${colors.surface};border:1px solid ${colors.border};border-radius:${radius.sm};padding:3px;}
    #soShareOverlay .so-seg-opt{flex:1;margin:0;position:relative;}
    #soShareOverlay .so-seg-opt input{position:absolute;opacity:0;pointer-events:none;}
    #soShareOverlay .so-seg-opt span{display:block;text-align:center;padding:7px 8px;border-radius:calc(${radius.sm} - 3px);font-size:13px;font-weight:600;color:${colors.textSecondary};cursor:pointer;transition:background .12s,color .12s;}
    #soShareOverlay .so-seg-opt input:checked+span{background:${colors.bgElevated};color:${colors.text};box-shadow:${shadows.sm};}
    #soShareOverlay .so-seg-opt.disabled span{color:${colors.textTertiary};cursor:not-allowed;}
    #soShareOverlay .so-hint{font-size:12px;color:${colors.textTertiary};margin-top:6px;}
    #soShareOverlay .so-status{font-size:13px;min-height:18px;margin-top:4px;color:${colors.textSecondary};}
    #soShareOverlay .so-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;}
    #soShareOverlay button.so-btn{padding:9px 16px;border-radius:${radius.sm};font:inherit;font-size:14px;font-weight:600;cursor:pointer;border:1px solid transparent;}
    #soShareOverlay button.so-ghost{background:transparent;border-color:${colors.border};color:${colors.textSecondary};}
    #soShareOverlay button.so-primary{background:${colors.primary};color:${colors.textInverse};}
    #soShareOverlay button.so-primary:disabled{opacity:0.55;cursor:default;}
    #soShareOverlay button.so-copy{background:${colors.surface};border-color:${colors.border};color:${colors.text};white-space:nowrap;}
    #soShareOverlay .so-emailwrap{position:relative;}
    #soShareOverlay .so-people{position:absolute;left:0;right:0;top:calc(100% + 2px);z-index:5;background:${colors.bgElevated};border:1px solid ${colors.border};border-radius:${radius.sm};box-shadow:${shadows.lg};max-height:180px;overflow:auto;display:none;}
    #soShareOverlay .so-people.open{display:block;}
    #soShareOverlay .so-people-item{display:flex;flex-direction:column;padding:7px 12px;cursor:pointer;}
    #soShareOverlay .so-people-item:hover,#soShareOverlay .so-people-item.active{background:${colors.surface};}
    #soShareOverlay .so-people-name{font-size:13px;color:${colors.text};}
    #soShareOverlay .so-people-email{font-size:12px;color:${colors.textTertiary};}
  </style>
  <div class="so-share-backdrop" onclick="closeShare()"></div>
  <div class="so-share-panel">
    <h3 id="soShareTitle">Share</h3>
    <div class="so-field">
      <label for="soShareLink">Link</label>
      <div class="so-link-row">
        <input type="text" id="soShareLink" readonly>
        <button type="button" class="so-btn so-copy" onclick="shareCopyLink()">Copy</button>
      </div>
    </div>
    <div class="so-field">
      <label for="soShareEmails">Send to (emails, comma-separated)</label>
      <div class="so-emailwrap">
        <input type="text" id="soShareEmails" placeholder="alex@example.com, sam@example.com" autocomplete="off">
        <div class="so-people" id="soSharePeople"></div>
      </div>
    </div>
    <div class="so-field">
      <label for="soShareMessage">Message (optional)</label>
      <textarea id="soShareMessage" placeholder="Add a short note…"></textarea>
    </div>
    <div class="so-field">
      <label>Recipient access</label>
      <div class="so-seg" id="soShareSeg">
        <label class="so-seg-opt"><input type="radio" name="soShareRole" value="none" checked><span>Link only</span></label>
        <label class="so-seg-opt" id="soShareOptViewer"><input type="radio" name="soShareRole" value="viewer"><span>Viewer</span></label>
        <label class="so-seg-opt" id="soShareOptEditor"><input type="radio" name="soShareRole" value="editor"><span>Editor</span></label>
      </div>
      <div class="so-hint" id="soShareHint"></div>
    </div>
    <div class="so-status" id="soShareStatus"></div>
    <div class="so-actions">
      <button type="button" class="so-btn so-ghost" onclick="closeShare()">Cancel</button>
      <button type="button" class="so-btn so-primary" id="soShareSend" onclick="submitShare()">Send</button>
    </div>
  </div>
</div>`;
}

export function shareModalScript(opts: { baseUrl: string }): string {
  const base = JSON.stringify(opts.baseUrl || '');
  return `(function(){
  var BASE=${base};
  var current={id:null};
  function toast(msg,type){
    if(window.showToast){window.showToast(msg,type);return;}
    var el=document.createElement('div');
    el.textContent=msg;
    el.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1200;background:${colors.text};color:${colors.textInverse};padding:10px 16px;border-radius:${radius.sm};font:600 13px system-ui,sans-serif;box-shadow:${shadows.lg};';
    document.body.appendChild(el);
    setTimeout(function(){el.remove();},2200);
  }
  function $(id){return document.getElementById(id);}
  var people=[];
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function loadPeople(id,workspaceId){
    people=[];
    // Workspace artifacts: preload workspace members. Personal artifacts: fall back to
    // existing collaborators/commenters on the artifact.
    var url=workspaceId
      ?BASE+'/v1/workspaces/'+workspaceId+'/members'
      :BASE+'/v1/data/'+id+'/comments/_people';
    fetch(url,{credentials:'include'})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(d){
        if(!d)return;
        var list=workspaceId?(d.members||[]):(d.people||[]);
        people=list.map(function(p){return {email:p.email,name:p.name};}).filter(function(p){return p.email;});
      })
      .catch(function(){});
  }
  function lastToken(v){var parts=v.split(/[,\\s]+/);return parts.length?parts[parts.length-1].trim().toLowerCase():'';}
  function renderPeople(){
    var inp=$('soShareEmails'),box=$('soSharePeople');if(!inp||!box)return;
    var tok=lastToken(inp.value);
    var chosen=inp.value.toLowerCase();
    var matches=people.filter(function(p){
      if(chosen.indexOf(p.email.toLowerCase())!==-1)return false;
      if(!tok)return true;
      return p.email.toLowerCase().indexOf(tok)!==-1||(p.name&&p.name.toLowerCase().indexOf(tok)!==-1);
    }).slice(0,6);
    if(!matches.length){box.classList.remove('open');box.innerHTML='';return;}
    box.innerHTML=matches.map(function(p){
      return '<div class="so-people-item" onmousedown="shareePick(event,'+JSON.stringify(p.email)+')">'+
        '<span class="so-people-name">'+esc(p.name||p.email)+'</span>'+
        (p.name?'<span class="so-people-email">'+esc(p.email)+'</span>':'')+'</div>';
    }).join('');
    box.classList.add('open');
  }
  window.shareePick=function(e,email){
    e.preventDefault();
    var inp=$('soShareEmails');
    var parts=inp.value.split(/,/);parts.pop();
    parts.push(' '+email);
    inp.value=parts.join(',').replace(/^[\\s,]+/,'')+', ';
    $('soSharePeople').classList.remove('open');
    inp.focus();
  };
  window.openShare=function(id,slug,name,canManage,workspaceId){
    current.id=id;
    loadPeople(id,workspaceId);
    var ov=$('soShareOverlay'); if(!ov)return;
    $('soShareTitle').textContent=name?('Share "'+name+'"'):'Share';
    $('soShareLink').value=BASE+'/a/'+slug+'/';
    $('soShareEmails').value=''; $('soShareMessage').value=''; $('soShareStatus').textContent='';
    var none=ov.querySelector('input[value=none]'); if(none)none.checked=true;
    var vOpt=$('soShareOptViewer'),eOpt=$('soShareOptEditor');
    [vOpt,eOpt].forEach(function(o){if(!o)return;var inp=o.querySelector('input');inp.disabled=!canManage;o.classList.toggle('disabled',!canManage);});
    $('soShareHint').textContent=canManage?'Viewers/Editors are saved as collaborators and can open private artifacts.':'Only owners/editors can add people. You can still send a link.';
    ov.style.display='flex';
  };
  window.closeShare=function(){var ov=$('soShareOverlay'); if(ov)ov.style.display='none';};
  window.shareCopyLink=function(){var v=$('soShareLink').value; if(navigator.clipboard){navigator.clipboard.writeText(v);} toast('Link copied!');};
  window.submitShare=function(){
    if(!current.id)return;
    var emails=$('soShareEmails').value.split(/[,\\s]+/).map(function(e){return e.trim();}).filter(Boolean);
    if(!emails.length){$('soShareStatus').textContent='Enter at least one email, or use Copy.';return;}
    var roleEl=document.querySelector('input[name=soShareRole]:checked');
    var role=roleEl?roleEl.value:'none';
    var btn=$('soShareSend'); btn.disabled=true; $('soShareStatus').textContent='Sending…';
    fetch(BASE+'/v1/artifacts/'+current.id+'/share',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({recipients:emails,message:$('soShareMessage').value||undefined,role:role})})
      .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
      .then(function(res){
        if(!res.ok){$('soShareStatus').textContent=(res.d&&res.d.error)||'Failed to share.';return;}
        var n=(res.d.sent||[]).length;
        toast(n+' invite'+(n===1?'':'s')+' sent');
        window.closeShare();
      })
      .catch(function(){$('soShareStatus').textContent='Network error.';})
      .finally(function(){btn.disabled=false;});
  };
  var emailInp=$('soShareEmails');
  if(emailInp){
    emailInp.addEventListener('input',renderPeople);
    emailInp.addEventListener('focus',renderPeople);
    emailInp.addEventListener('blur',function(){setTimeout(function(){var b=$('soSharePeople');if(b)b.classList.remove('open');},150);});
  }
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape')return;
    var ov=$('soShareOverlay');
    if(ov&&ov.style.display!=='none'&&ov.style.display!==''){window.closeShare();}
  });
})();`;
}
