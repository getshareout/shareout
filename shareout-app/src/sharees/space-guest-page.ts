// The space-guest side of /shared?folder=<id>: a guest with a live session for the space
// sees its items under the workspace's own branding; anyone else gets one neutral sign-in
// card (email → code) that says nothing about the folder, so a folder id is no oracle.
import type { Env } from '../types';
import { renderHtmlPage } from '../design-system/shell';
import { escapeHtml } from '../html/utils';
import { parseBranding } from '../workspaces/branding';
import { localeFromAcceptLanguage, localeForViewer, type Locale } from '../i18n/locale';
import { renderPortal } from './portal-page';
import { recordSpaceGuestView, resolveSpaceGuests, spaceGuestCovers, type SpaceGuest } from './space-guest';

const COPY = {
  en: {
    signedAs: 'Viewing as',
    signOut: 'Sign out',
    title: 'Open a shared space',
    intro: 'Enter the email this space was shared with. We will send you a code — no account or password needed.',
    expired: 'That link has expired. Ask for a code instead.',
    email: 'Your email',
    name: 'Your name (shown on comments)',
    send: 'Email me a code',
    code: '6-digit code',
    open: 'Open the space',
    sent: 'If this space was shared with that email, a code is on its way.',
    wrong: 'That code did not match. Ask for a new one if it expired.',
    many: 'Too many tries. Wait a little and try again.',
    fail: 'Something went wrong. Try again.',
    account: 'Have a ShareOut account?',
    signIn: 'Sign in',
  },
  es: {
    signedAs: 'Viendo como',
    signOut: 'Salir',
    title: 'Abrí un espacio compartido',
    intro: 'Ingresá el mail con el que te compartieron este espacio. Te mandamos un código: no necesitás cuenta ni contraseña.',
    expired: 'Ese enlace venció. Pedí un código.',
    email: 'Tu mail',
    name: 'Tu nombre (se ve en los comentarios)',
    send: 'Mandame un código',
    code: 'Código de 6 dígitos',
    open: 'Abrir el espacio',
    sent: 'Si te compartieron este espacio con ese mail, el código ya está en camino.',
    wrong: 'Ese código no coincide. Pedí uno nuevo si venció.',
    many: 'Demasiados intentos. Esperá un rato y probá de nuevo.',
    fail: 'Algo salió mal. Probá de nuevo.',
    account: '¿Tenés cuenta en ShareOut?',
    signIn: 'Iniciar sesión',
  },
} satisfies Record<Locale, Record<string, string>>;

const STYLES = `
  .sg-wrap { max-width: 420px; margin: 0 auto; padding: var(--space-16) var(--space-6); }
  .sg-card { border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-8); display: grid; gap: var(--space-3); }
  .sg-card h1 { margin: 0; font-size: var(--font-size-xl); color: var(--color-text-primary); }
  .sg-card p { margin: 0; color: var(--color-text-secondary); font-size: var(--font-size-sm); line-height: 1.55; }
  .sg-msg { min-height: 1.2em; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
  .sg-msg.is-error { color: var(--color-error); }
  .sg-alt { margin-top: var(--space-4); font-size: var(--font-size-sm); color: var(--color-text-secondary); text-align: center; }
  .pt-guest { display: flex; align-items: center; gap: var(--space-3); margin: calc(-1 * var(--space-6)) 0 var(--space-8); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
  .pt-guest form { margin: 0; }
  .pt-guest button { background: none; border: 0; padding: 0; color: var(--color-text-secondary); font: inherit; text-decoration: underline; cursor: pointer; }
`;

/** The guest whose session reaches `folderId` (a subfolder of their space counts), or null. */
async function guestForFolder(request: Request, env: Env, folderId: string): Promise<SpaceGuest | null> {
  for (const g of await resolveSpaceGuests(request, env)) {
    if (await spaceGuestCovers(env, g, 'folder', folderId)) return g;
  }
  return null;
}

/** The guest's portal for `folderId`, or null when no live session on this request reaches it. */
export async function handleSpaceGuestPortal(request: Request, env: Env, folderId: string): Promise<Response | null> {
  const guest = await guestForFolder(request, env, folderId);
  if (!guest) return null;
  const ws = guest.workspaceId;
  const subtree = `WITH RECURSIVE sub(id, depth) AS (
      SELECT ?, 0
      UNION
      SELECT f.id, s.depth + 1 FROM folders f JOIN sub s ON f.parent_id = s.id
       WHERE f.workspace_id = ? AND s.depth < 32
    )`;
  const [folder, workspace, arts, files, locale] = await Promise.all([
    env.DB.prepare('SELECT name FROM folders WHERE id = ? AND workspace_id = ?').bind(folderId, ws).first<{ name: string | null }>(),
    env.DB.prepare('SELECT name, branding FROM workspaces WHERE id = ?').bind(ws).first<{ name: string; branding: string | null }>(),
    env.DB.prepare(`${subtree}
      SELECT a.slug, a.name FROM artifacts a
       WHERE a.deleted_at IS NULL AND a.workspace_id = ? AND a.folder_id IN (SELECT id FROM sub)
       ORDER BY a.name`).bind(folderId, ws, ws).all<{ slug: string; name: string }>(),
    env.DB.prepare(`${subtree}
      SELECT d.id, d.name, d.bucket_artifact_id, b.filename
        FROM asset_deliverables d
        JOIN blobs b ON b.deliverable_id = d.id
         AND b.version_no = (SELECT MAX(version_no) FROM blobs WHERE deliverable_id = d.id)
       WHERE d.deleted_at IS NULL AND d.workspace_id = ? AND d.folder_id IN (SELECT id FROM sub)
         AND d.visibility NOT IN ('private', 'team')
       ORDER BY d.name`).bind(folderId, ws, ws).all<{ id: string; name: string; bucket_artifact_id: string; filename: string }>(),
    localeForViewer(env, { workspaceId: ws, request }),
  ]);
  const c = COPY[locale];
  const brand = parseBranding(workspace?.branding);
  await recordSpaceGuestView(env, guest, 'folder', folderId);

  const note = `<div class="pt-guest">${escapeHtml(c.signedAs)} <strong>${escapeHtml(guest.email)}</strong>
        <form method="post" action="/shared/guest/signout"><button type="submit">${escapeHtml(c.signOut)}</button></form></div>`;
  return renderPortal({
    title: folder?.name || workspace?.name || 'Shared space',
    accent: brand.accent_color,
    logo: brand.logo_ext ? `/wl/${ws}.${brand.logo_ext}` : null,
    logoAlt: workspace?.name ?? '',
    back: guest.folderId !== folderId ? `<a class="pt-back" href="/shared?folder=${encodeURIComponent(guest.folderId)}">&larr;</a>` : '',
    artifacts: (arts.results || []).map((a) => ({ slug: a.slug, name: a.name, workspace_name: workspace?.name ?? null })),
    files: (files.results || []).map((f) => ({
      id: f.id, name: f.name, filename: f.filename, workspace_name: workspace?.name ?? null,
      contentPath: `/v1/files/${f.id}/content`, bucketId: f.bucket_artifact_id,
    })),
    note,
    readOnly: guest.capability !== 'comment',
    styles: STYLES,
  });
}

/** The neutral sign-in card: identical for every folder id, granted or not. */
export function renderSpaceGuestSignIn(request: Request, folderId: string): Response {
  const url = new URL(request.url);
  const locale: Locale = localeFromAcceptLanguage(request.headers.get('Accept-Language')) ?? 'en';
  const c = COPY[locale];
  const expired = url.searchParams.get('link') === 'expired';
  const login = `/auth/login?redirect=${encodeURIComponent(`/shared?folder=${folderId}`)}`;
  const body = `
    <div class="sg-wrap">
      <div class="sg-card">
        <h1>${escapeHtml(c.title)}</h1>
        <p>${escapeHtml(expired ? c.expired : c.intro)}</p>
        <label class="so-c-label" for="sgEmail">${escapeHtml(c.email)}</label>
        <input class="so-c-input" id="sgEmail" type="email" autocomplete="email" maxlength="254">
        <button class="so-c-btn so-c-btn--primary" id="sgSend" type="button">${escapeHtml(c.send)}</button>
        <div id="sgCodeWrap" hidden style="display:grid;gap:var(--space-3)">
          <label class="so-c-label" for="sgName">${escapeHtml(c.name)}</label>
          <input class="so-c-input" id="sgName" type="text" autocomplete="name" maxlength="80">
          <label class="so-c-label" for="sgCode">${escapeHtml(c.code)}</label>
          <input class="so-c-input" id="sgCode" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
          <button class="so-c-btn so-c-btn--primary" id="sgOpen" type="button">${escapeHtml(c.open)}</button>
        </div>
        <div class="sg-msg" id="sgMsg" aria-live="polite"></div>
      </div>
      <p class="sg-alt">${escapeHtml(c.account)} <a href="${escapeHtml(login)}">${escapeHtml(c.signIn)}</a></p>
    </div>
    <script>(function(){
      var F=${JSON.stringify(folderId).replace(/</g, '\\u003c')},T=${JSON.stringify({ sent: c.sent, wrong: c.wrong, many: c.many, fail: c.fail }).replace(/</g, '\\u003c')};
      function el(i){return document.getElementById(i);}
      function msg(t,bad){var m=el('sgMsg');m.textContent=t||'';m.className='sg-msg'+(bad?' is-error':'');}
      function post(p,b){return fetch('/shared/guest/'+p,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return{};}).then(function(j){return{ok:r.ok,status:r.status,j:j};});});}
      el('sgSend').addEventListener('click',function(){
        var e=el('sgEmail').value.trim();if(e.indexOf('@')<1)return;
        var b=el('sgSend');b.disabled=true;
        post('code',{folder:F,email:e}).then(function(r){b.disabled=false;if(r.ok){el('sgCodeWrap').hidden=false;msg(T.sent);el('sgCode').focus();}else msg(r.status===429?T.many:T.fail,true);}).catch(function(){b.disabled=false;msg(T.fail,true);});
      });
      el('sgOpen').addEventListener('click',function(){
        var code=el('sgCode').value.trim();if(!/^[0-9]{6}$/.test(code)){msg(T.wrong,true);return;}
        post('verify',{folder:F,email:el('sgEmail').value.trim(),code:code,name:el('sgName').value.trim()}).then(function(r){
          if(r.ok&&r.j&&r.j.data){location.href=r.j.data.redirect;return;}
          msg(r.status===429?T.many:T.wrong,true);
        }).catch(function(){msg(T.fail,true);});
      });
    })();</script>`;
  return renderHtmlPage({
    title: c.title,
    description: c.intro,
    pageStyles: STYLES,
    body,
    lang: locale,
    cacheControl: 'no-store',
  });
}
