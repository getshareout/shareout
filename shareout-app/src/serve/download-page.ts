/**
 * Public WeTransfer-style download page for an asset collection share link.
 * Served at /d/<dlk token>. Open by default; an optional gate (password or
 * email domain) must be cleared before the files are revealed. Optional expiry.
 */
import { getPlatformOrigin } from '../config/origins';
import type { Env } from '../types';
import { renderHtmlPage } from '../design-system/shell';
import { colors, fonts, radius } from '../../packages/design-tokens/src/index';
import { resolveShareLink, bumpShareLinkViews, hashAssetLinkPassword, type ResolvedShareLink } from '../assets/deliverables';
import { escapeHtml } from '../email/layout';
import { dispatchLifecycleEmail } from '../email/gateway';
import { localeTag, resolveLocale, type Locale } from '../i18n/locale';
import { type LocaleCopy } from '../i18n';

const DL_COPY: LocaleCopy<{
  deliveredWith: string; unavailableTitle: string; unavailableDesc: string; unavailable: string; unavailableSub: string;
  password: string; emailPh: string; passwordPrompt: string; emailPrompt: string; protectedTitle: string;
  protectedDesc: string; protected: string; continue: string; download: string; availableUntil: string;
  file: string; files: string; forYou: string; empty: string;
  badPassword: string; badEmail: string; badDomain: string;
}> = {
  en: {
    deliveredWith: 'Delivered with', unavailableTitle: 'Link unavailable — ShareOut', unavailableDesc: 'This download link is no longer available.',
    unavailable: 'Link unavailable', unavailableSub: 'This download link has expired or been removed.',
    password: 'Password', emailPh: 'you@company.com', passwordPrompt: 'This delivery is password protected.',
    emailPrompt: 'Enter your email to access this delivery.', protectedTitle: 'Protected delivery — ShareOut',
    protectedDesc: 'This delivery is protected.', protected: 'Protected delivery', continue: 'Continue', download: 'Download',
    availableUntil: 'Available until ', file: 'file ready to download.', files: 'files ready to download.', forYou: 'Files for you',
    empty: 'No files in this delivery.', badPassword: 'Incorrect password.', badEmail: 'Enter a valid email.',
    badDomain: 'That email domain is not permitted for this delivery.',
  },
  es: {
    deliveredWith: 'Enviado con', unavailableTitle: 'Enlace no disponible — ShareOut', unavailableDesc: 'Este enlace de descarga ya no está disponible.',
    unavailable: 'Enlace no disponible', unavailableSub: 'Este enlace de descarga venció o lo dieron de baja.',
    password: 'Contraseña', emailPh: 'vos@empresa.com', passwordPrompt: 'Este envío tiene contraseña.',
    emailPrompt: 'Escribí tu mail para ver este envío.', protectedTitle: 'Envío protegido — ShareOut',
    protectedDesc: 'Este envío está protegido.', protected: 'Envío protegido', continue: 'Continuar', download: 'Descargar',
    availableUntil: 'Disponible hasta el ', file: 'archivo listo para descargar.', files: 'archivos listos para descargar.', forYou: 'Archivos para vos',
    empty: 'Este envío no tiene archivos.', badPassword: 'La contraseña no es correcta.', badEmail: 'Escribí un mail válido.',
    badDomain: 'Ese dominio de mail no tiene acceso a este envío.',
  },
};

/** The delivery's workspace language, else the visitor's browser. */
async function deliveryLocale(env: Env, request: Request, bucketId: string | null): Promise<Locale> {
  const row = bucketId
    ? await env.DB.prepare('SELECT w.locale FROM artifacts a JOIN workspaces w ON w.id = a.workspace_id WHERE a.id = ?')
      .bind(bucketId).first<{ locale: string }>().catch(() => null)
    : null;
  return resolveLocale({ workspace: row?.locale, acceptLanguage: request.headers.get('Accept-Language') });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

const fileIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
const dlIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M12 3v12"/><path d="M7 12l5 5 5-5"/><path d="M5 21h14"/></svg>';
const lockIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

function pageStyles(): string {
  return `
    body { background: ${colors.bg}; color: ${colors.text}; font-family: ${fonts.body}; }
    .dl-wrap { max-width: 560px; margin: 0 auto; padding: 48px 20px 64px; }
    .dl-card { background: ${colors.bgElevated}; border: 1px solid ${colors.border}; border-radius: ${radius.lg}; box-shadow: 0 20px 60px -20px rgba(28,25,23,0.18); overflow: hidden; }
    .dl-head { padding: 28px 28px 22px; border-bottom: 1px solid ${colors.border}; }
    .dl-eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${colors.textTertiary}; margin: 0 0 8px; }
    .dl-title { font: 800 26px ${fonts.display || fonts.body}; margin: 0; line-height: 1.15; }
    .dl-sub { color: ${colors.textSecondary}; font-size: 14px; margin: 8px 0 0; }
    .dl-list { list-style: none; margin: 0; padding: 8px; }
    .dl-row { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: ${radius.md}; }
    .dl-row + .dl-row { border-top: 1px solid ${colors.border}; }
    .dl-fi { color: ${colors.primary}; flex-shrink: 0; display: flex; }
    .dl-meta { min-width: 0; flex: 1; }
    .dl-name { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dl-sz { font-size: 12px; color: ${colors.textTertiary}; margin-top: 2px; }
    .dl-btn { flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: ${radius.md}; background: ${colors.primary}; color: ${colors.textInverse}; font: 600 13px ${fonts.body}; text-decoration: none; border: 0; cursor: pointer; }
    .dl-btn--block { width: 100%; justify-content: center; }
    .dl-foot { text-align: center; color: ${colors.textTertiary}; font-size: 12px; margin: 22px 0 0; }
    .dl-foot a { color: ${colors.textSecondary}; text-decoration: none; }
    .dl-empty { padding: 48px 28px; text-align: center; color: ${colors.textSecondary}; }
    .dl-gate { padding: 36px 28px; text-align: center; }
    .dl-gate__ic { color: ${colors.primary}; display: inline-flex; margin-bottom: 12px; }
    .dl-gate input { width: 100%; box-sizing: border-box; padding: 12px 14px; margin: 16px 0 12px; border: 1px solid ${colors.borderStrong}; border-radius: ${radius.md}; font: 15px ${fonts.body}; }
    .dl-gate__err { color: ${colors.error}; font-size: 13px; margin: 0 0 8px; }
  `;
}

function withCookie(resp: Response, cookie: string | null): Response {
  if (!cookie) return resp;
  const headers = new Headers(resp.headers);
  headers.append('Set-Cookie', cookie);
  return new Response(resp.body, { status: resp.status, headers });
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('Cookie') || '';
  const m = raw.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * The delivery footer a *recipient* sees. It used to link to shareout.site
 * unconditionally, so a self-hoster sending a file to a client advertised
 * someone else's product on the way out. Point it at the instance that served it.
 */
function deliveredFooter(env: Env, locale: Locale): string {
  const origin = getPlatformOrigin(env);
  return `<p class="dl-foot">${DL_COPY[locale].deliveredWith} <a href="${origin}">ShareOut</a></p>`;
}

function renderUnavailable(env: Env, locale: Locale): Response {
  const c = DL_COPY[locale];
  return renderHtmlPage({
    title: c.unavailableTitle,
    description: c.unavailableDesc,
    pageStyles: pageStyles(),
    lang: locale,
    status: 404,
    body: `<div class="dl-wrap"><div class="dl-card"><div class="dl-empty"><h1 class="dl-title">${c.unavailable}</h1><p class="dl-sub">${c.unavailableSub}</p></div></div>${deliveredFooter(env, locale)}</div>`,
  });
}

function renderGate(env: Env, token: string, gate: 'password' | 'domain', error: string | null, locale: Locale, status = 200): Response {
  const c = DL_COPY[locale];
  const field = gate === 'password'
    ? `<input type="password" name="password" placeholder="${c.password}" autofocus required>`
    : `<input type="email" name="email" placeholder="${c.emailPh}" autofocus required>`;
  const prompt = gate === 'password' ? c.passwordPrompt : c.emailPrompt;
  return renderHtmlPage({
    title: c.protectedTitle,
    description: c.protectedDesc,
    pageStyles: pageStyles(),
    lang: locale,
    status,
    body: `
      <div class="dl-wrap">
        <div class="dl-card">
          <form class="dl-gate" method="POST" action="/d/${escapeHtml(token)}">
            <span class="dl-gate__ic">${lockIcon}</span>
            <h1 class="dl-title">${c.protected}</h1>
            <p class="dl-sub">${prompt}</p>
            ${error ? `<p class="dl-gate__err">${escapeHtml(error)}</p>` : ''}
            ${field}
            <button class="dl-btn dl-btn--block" type="submit">${c.continue}</button>
          </form>
        </div>
        ${deliveredFooter(env, locale)}
      </div>`,
  });
}

async function renderFiles(env: Env, token: string, data: ResolvedShareLink, setCookie: string | null, locale: Locale, viewerEmail: string | null = null): Promise<Response> {
  const c = DL_COPY[locale];
  // First open → tell the sender ("Acme opened your delivery"). Dedupe on the
  // 0→1 view transition so a refresh doesn't re-notify.
  if (data.viewCount === 0 && data.createdBy) {
    await dispatchLifecycleEmail(env, {
      type: 'asset_delivery_opened',
      toUserId: data.createdBy,
      data: { collectionName: data.collectionName, viewerEmail },
    }).catch(() => {});
  }
  await bumpShareLinkViews(env, token).catch(() => {});
  const n = data.files.length;
  const rows = data.files.map((f) => `
    <li class="dl-row">
      <span class="dl-fi">${fileIcon}</span>
      <span class="dl-meta">
        <div class="dl-name" title="${escapeHtml(f.filename)}">${escapeHtml(f.deliverableName || f.filename)}</div>
        <div class="dl-sz">${escapeHtml(f.filename)} · ${fmtBytes(f.sizeBytes)}${f.version > 1 ? ` · v${f.version}` : ''}</div>
      </span>
      <a class="dl-btn" href="/d/${escapeHtml(token)}/file/${escapeHtml(f.blobId)}" download>${dlIcon}<span>${c.download}</span></a>
    </li>`).join('');
  const exp = data.expiresAt
    ? `<p class="dl-sub">${c.availableUntil}${escapeHtml(new Date(data.expiresAt).toLocaleDateString(localeTag(locale), { month: 'long', day: 'numeric', year: 'numeric' }))}.</p>`
    : '';
  const resp = renderHtmlPage({
    title: `${data.collectionName} — ShareOut`,
    description: `${n} ${n === 1 ? c.file : c.files}`,
    pageStyles: pageStyles(),
    lang: locale,
    body: `
      <div class="dl-wrap">
        <div class="dl-card">
          <div class="dl-head">
            <p class="dl-eyebrow">${c.forYou}</p>
            <h1 class="dl-title">${escapeHtml(data.collectionName)}</h1>
            <p class="dl-sub">${n} ${n === 1 ? c.file : c.files}</p>
            ${exp}
          </div>
          <ul class="dl-list">${rows || `<div class="dl-empty">${c.empty}</div>`}</ul>
        </div>
        ${deliveredFooter(env, locale)}
      </div>`,
  });
  return withCookie(resp, setCookie);
}

/** True when the visitor has already cleared the link's gate (cookie set on a
 *  prior page visit). The same check guards both the listing page and the bytes. */
function gateCleared(request: Request, token: string, data: ResolvedShareLink): boolean {
  if (data.gate === 'none') return true;
  const cookie = readCookie(request, `so_dl_${token}`);
  if (!cookie) return false;
  if (data.gate === 'password') return cookie === data.gateValue;
  const dom = (cookie.split('@')[1] || '').toLowerCase();
  return (data.gateValue || '').split(',').filter(Boolean).includes(dom);
}

/** Stream a delivery's file through the gate — the bytes are NOT served from the
 *  public blob URL, so a protected delivery's files can't be fetched without
 *  clearing the gate. */
export async function handleDeliveryFile(token: string, blobId: string, env: Env, request: Request): Promise<Response> {
  const data = await resolveShareLink(env, token);
  if (!data) return new Response('Not found', { status: 404 });
  if (!gateCleared(request, token, data)) {
    // Bounce to the page so the visitor can clear the gate first.
    return new Response(null, { status: 302, headers: { Location: `/d/${encodeURIComponent(token)}` } });
  }
  if (!data.files.some((f) => f.blobId === blobId)) return new Response('Not found', { status: 404 });

  const blob = await env.DB.prepare(
    'SELECT r2_key, mime_type, filename, size_bytes FROM blobs WHERE id = ? AND artifact_id = ?',
  ).bind(blobId, data.bucketId).first<{ r2_key: string; mime_type: string; filename: string; size_bytes: number }>();
  if (!blob) return new Response('Not found', { status: 404 });

  const obj = await env.ARTIFACTS.get(blob.r2_key);
  if (!obj) return new Response('File missing', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': blob.mime_type,
      'Content-Length': String(blob.size_bytes),
      'Content-Disposition': `attachment; filename="${blob.filename.replace(/"/g, '')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function handleDownloadPage(token: string, env: Env, request: Request): Promise<Response> {
  const data = await resolveShareLink(env, token);
  const locale = await deliveryLocale(env, request, data?.bucketId ?? null);
  if (!data) return renderUnavailable(env, locale);
  if (data.gate === 'none') return renderFiles(env, token, data, null, locale);

  const cookieName = `so_dl_${token}`;
  const secure = (env.SHAREOUT_BASE_URL || '').startsWith('https') ? ' Secure;' : '';
  const setCookie = (val: string) => `${cookieName}=${encodeURIComponent(val)}; Path=/d/${token}; HttpOnly;${secure} SameSite=Lax; Max-Age=86400`;
  const domainOk = (email: string) => {
    const dom = (email.split('@')[1] || '').toLowerCase();
    return (data.gateValue || '').split(',').filter(Boolean).includes(dom);
  };

  // Already cleared this gate on a prior visit?
  if (gateCleared(request, token, data)) {
    const known = data.gate === 'domain' ? readCookie(request, cookieName) : null;
    return renderFiles(env, token, data, null, locale, known);
  }

  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    if (data.gate === 'password') {
      const pw = String(form?.get('password') || '');
      if (pw && (await hashAssetLinkPassword(pw)) === data.gateValue) {
        return renderFiles(env, token, data, setCookie(data.gateValue || ''), locale);
      }
      return renderGate(env, token, 'password', DL_COPY[locale].badPassword, locale, 401);
    }
    const email = String(form?.get('email') || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return renderGate(env, token, 'domain', DL_COPY[locale].badEmail, locale, 401);
    if (!domainOk(email)) return renderGate(env, token, 'domain', DL_COPY[locale].badDomain, locale, 403);
    return renderFiles(env, token, data, setCookie(email), locale, email);
  }

  return renderGate(env, token, data.gate, null, locale);
}
