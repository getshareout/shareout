import type { Env } from '../types';
import { brandLockupHtml } from '../brand';
import { renderHtmlPage } from '../design-system/shell';
import { escapeHtml } from '../html/utils';
import { countLinkedChats, getBotUsername, mintLinkCode } from '../telegram/linking';

interface TelegramConnectUser {
  id: string;
  email: string | null;
}

const telegramConnectStyles = `
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

/** Mint a fresh link code and 302 straight to the Telegram bot deep link, skipping
 *  the intermediate settings page. Falls back to null when the bot isn't available. */
export async function telegramDeepLinkRedirect(env: Env, user: TelegramConnectUser): Promise<Response | null> {
  const [code, username] = await Promise.all([mintLinkCode(env, user.id), getBotUsername(env)]);
  if (!username || !code) return null;
  const deepLink = `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(code)}`;
  return Response.redirect(deepLink, 302);
}

export async function renderTelegramConnectPage(env: Env, user: TelegramConnectUser): Promise<Response> {
  const [linkedCount, code, username] = await Promise.all([
    countLinkedChats(env, user.id),
    mintLinkCode(env, user.id),
    getBotUsername(env),
  ]);

  const action = username && code
    ? `<a class="so-c-btn so-c-btn--primary" href="https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(code)}">Open Telegram</a>`
    : '<span class="tg-status">Telegram chat is not available right now. Try again in a bit.</span>';

  const connected = linkedCount > 0
    ? `<div class="tg-status"><strong>Connected.</strong> Open Telegram and start chatting. To disconnect, send <strong>/unlink</strong> to the bot.</div>`
    : '';

  const email = user.email ? ` for ${escapeHtml(user.email)}` : '';
  const body = `<main class="tg-page">
  <section class="tg-card">
    <div class="tg-brand">${brandLockupHtml({ href: '/home' })}</div>
    <p class="tg-kicker">Telegram</p>
    <h1 class="tg-title">Chat with your pages.</h1>
    <p class="tg-copy">
      Connect Telegram${email}, then ask the bot to find, read, and summarize your pages.
      It only sees what your ShareOut account can see.
    </p>
    <div class="tg-actions">
      ${action}
      <a class="so-c-btn so-c-btn--secondary" href="/home">Back to ShareOut</a>
    </div>
    ${connected}
    <p class="tg-help">The Telegram link works for 15 minutes and can only be used once.</p>
  </section>
</main>`;

  return renderHtmlPage({
    title: 'Connect Telegram · ShareOut',
    description: 'Connect Telegram to your ShareOut account.',
    pageStyles: telegramConnectStyles,
    body,
    cacheControl: 'private, no-cache',
  });
}
