import type { Env } from '../types';
import { brandLockupHtml } from '../brand';
import { renderHtmlPage } from '../design-system/shell';
import { escapeHtml } from '../html/utils';
import { localeForRecipient, type Locale } from '../i18n/locale';
import { t } from '../i18n';

// The page that connects a messaging app (Telegram, WhatsApp) to a ShareOut account: one
// button that opens the app with a one-time code. Same page, same words, for both apps.

export interface ChatConnectUser {
  id: string;
  email: string | null;
}

const chatConnectStyles = `
body {
  min-height: 100vh;
  background:
    radial-gradient(920px 620px at 80% -12%, #e4ecff 0%, transparent 58%),
    radial-gradient(760px 560px at 8% 6%, #fdede2 0%, transparent 54%),
    var(--color-bg);
}
.tg-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--space-6);
}
.tg-card {
  width: min(100%, 560px);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  padding: var(--space-8);
}
.tg-brand {
  margin-bottom: var(--space-8);
}
.tg-kicker {
  margin: 0 0 var(--space-3);
  color: var(--color-text-tertiary);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.tg-title {
  margin: 0;
  color: var(--color-text);
  font-family: var(--font-display);
  font-size: clamp(2rem, 6vw, 3rem);
  letter-spacing: -0.04em;
  line-height: 0.95;
}
.tg-copy {
  margin: var(--space-4) 0 0;
  color: var(--color-text-secondary);
  font-size: 1rem;
  line-height: 1.65;
}
.tg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-7);
}
.tg-status {
  margin-top: var(--space-6);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text-secondary);
}
.tg-status strong {
  color: var(--color-text);
}
.tg-help {
  margin-top: var(--space-6);
  color: var(--color-text-tertiary);
  font-size: 0.9rem;
}
@media (max-width: 520px) {
  .tg-page { padding: var(--space-4); place-items: stretch; }
  .tg-card { padding: var(--space-6); }
  .tg-actions { flex-direction: column; }
}
`;

const COPY = {
  en: {
    title: 'Chat with your pages.',
    copy: (app: string, email: string) => `Connect ${app}${email ? ` for ${email}` : ''}, then ask the assistant to find, read, and summarize your pages. It only sees what your ShareOut account can see.`,
    open: (app: string) => `Open ${app}`,
    back: 'Back to ShareOut',
    unavailable: (app: string) => `${app} chat is not available right now. Try again in a bit.`,
    connected: (app: string) => `<strong>Connected.</strong> Open ${app} and start chatting. To disconnect, send <strong>/unlink</strong> to the assistant.`,
    help: (app: string) => `The ${app} link works for 15 minutes and can only be used once.`,
    pageTitle: (app: string) => `Connect ${app} · ShareOut`,
  },
  es: {
    title: 'Hablá con tus artefactos.',
    copy: (app: string, email: string) => `Conectá ${app}${email ? ` para ${email}` : ''} y pedile al asistente que encuentre, lea y resuma tus artefactos. Solo ve lo que ve tu cuenta de ShareOut.`,
    open: (app: string) => `Abrir ${app}`,
    back: 'Volver a ShareOut',
    unavailable: (app: string) => `El chat de ${app} no está disponible ahora. Probá en un rato.`,
    connected: (app: string) => `<strong>Conectado.</strong> Abrí ${app} y empezá a escribir. Para desconectarte, mandale <strong>/unlink</strong> al asistente.`,
    help: (app: string) => `El link de ${app} dura 15 minutos y se usa una sola vez.`,
    pageTitle: (app: string) => `Conectar ${app} · ShareOut`,
  },
};

export async function chatConnectLocale(env: Env, user: ChatConnectUser): Promise<Locale> {
  return localeForRecipient(env, { userId: user.id }).catch((): Locale => 'en');
}

/** Render the connect page. `href` is the app's one-time link, or null when the app is unavailable. */
export async function renderChatConnectPage(
  env: Env,
  user: ChatConnectUser,
  opts: { app: string; href: string | null; linked: boolean },
): Promise<Response> {
  const c = t(await chatConnectLocale(env, user), COPY);
  const { app } = opts;
  const action = opts.href
    ? `<a class="so-c-btn so-c-btn--primary" href="${escapeHtml(opts.href)}">${escapeHtml(c.open(app))}</a>`
    : `<span class="tg-status">${escapeHtml(c.unavailable(app))}</span>`;
  const connected = opts.linked ? `<div class="tg-status">${c.connected(escapeHtml(app))}</div>` : '';
  const body = `<main class="tg-page">
  <section class="tg-card">
    <div class="tg-brand">${brandLockupHtml({ href: '/home' })}</div>
    <p class="tg-kicker">${escapeHtml(app)}</p>
    <h1 class="tg-title">${escapeHtml(c.title)}</h1>
    <p class="tg-copy">${escapeHtml(c.copy(app, user.email ?? ''))}</p>
    <div class="tg-actions">
      ${action}
      <a class="so-c-btn so-c-btn--secondary" href="/home">${escapeHtml(c.back)}</a>
    </div>
    ${connected}
    <p class="tg-help">${escapeHtml(c.help(app))}</p>
  </section>
</main>`;

  return renderHtmlPage({
    title: c.pageTitle(app),
    description: c.pageTitle(app),
    pageStyles: chatConnectStyles,
    body,
    cacheControl: 'private, no-cache',
  });
}
