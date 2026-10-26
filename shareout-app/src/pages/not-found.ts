/**
 * Styled 404 page — the design-system fallback for any unmatched route.
 */
import { renderHtmlPage } from '../design-system/shell';
import { brandLockupHtml } from '../brand';
import { escapeHtml } from '../html/utils';
import { localeFromAcceptLanguage, t, type LocaleCopy } from '../i18n';

/** Shared branded error/404 layout styles (also used by streamed page fallbacks). */
export const notFoundStyles = `
.nf-wrap {
  min-height: 100vh;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--space-6);
  padding: var(--space-8);
  text-align: center;
}
.nf-brand { margin-bottom: var(--space-2); }
.nf-code {
  font-family: var(--font-display);
  font-size: clamp(4rem, 14vw, 7rem); font-weight: 800;
  line-height: 1; letter-spacing: -0.04em;
  color: var(--color-primary);
}
.nf-title { font-family: var(--font-display); font-size: 1.5rem; font-weight: 700; color: var(--color-text); margin: 0; }
.nf-text { max-width: 30rem; color: var(--color-text-secondary); font-size: 1rem; line-height: 1.5; margin: 0; }
.nf-text code { font-family: var(--font-mono); font-size: 0.9em; color: var(--color-text); }
.nf-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); justify-content: center; margin-top: var(--space-2); }
`;

/** Branded inline body for a streamed page that failed mid-render (head already flushed). */
export function renderStreamedPageErrorBody(): string {
  return `<main class="nf-wrap">
  <div class="nf-brand">${brandLockupHtml({ markSize: 30, href: '/' })}</div>
  <h1 class="nf-title">Studio didn\u2019t load</h1>
  <p class="nf-text">We hit a snag loading your workspace \u2014 usually a temporary glitch. Try again, or head back to Home.</p>
  <div class="nf-actions">
    <button class="so-c-btn so-c-btn--primary" type="button" onclick="location.reload()">Try again</button>
    <a class="so-c-btn so-c-btn--secondary" href="/home">Back to Home</a>
  </div>
</main>`;
}

const NOT_FOUND_COPY: LocaleCopy<{ title: string; text: string; home: string; create: string; pageTitle: string; description: string }> = {
  en: {
    title: 'This page wandered off',
    text: "The link may be broken, or the page may have moved. Let's get you back to something live.",
    home: 'Go to my artifacts',
    create: 'Create with AI',
    pageTitle: 'Page not found · ShareOut',
    description: 'The page you are looking for could not be found.',
  },
  es: {
    title: 'Esta página se perdió',
    text: 'Puede que el link esté roto o que la página se haya movido. Volvamos a algo que funcione.',
    home: 'Ir a mis artefactos',
    create: 'Crear con IA',
    pageTitle: 'Página no encontrada · ShareOut',
    description: 'No pudimos encontrar la página que buscás.',
  },
};

/** Request-aware 404: styled page for document navigations, plain body for asset/API fetches. */
export function notFoundResponse(request: Request): Response {
  const wantsHtml = request.method === 'GET' && (request.headers.get('Accept') || '').includes('text/html');
  return wantsHtml ? renderNotFoundPage(request) : new Response('Not Found', { status: 404 });
}

export function renderNotFoundPage(request?: Request): Response {
  const locale = localeFromAcceptLanguage(request?.headers.get('Accept-Language')) ?? 'en';
  const c = t(locale, NOT_FOUND_COPY);
  const body = `<main class="nf-wrap">
  <div class="nf-brand">${brandLockupHtml({ markSize: 30, href: '/' })}</div>
  <div class="nf-code">404</div>
  <h1 class="nf-title">${c.title}</h1>
  <p class="nf-text">${c.text}</p>
  <div class="nf-actions">
    <a class="so-c-btn so-c-btn--primary" href="/home">${c.home}</a>
    <a class="so-c-btn so-c-btn--secondary" href="/create">${c.create}</a>
  </div>
</main>`;

  return renderHtmlPage({
    title: c.pageTitle,
    lang: locale,
    description: c.description,
    pageStyles: notFoundStyles,
    body,
    status: 404,
    cacheControl: 'no-cache',
  });
}

export function renderWorkspaceNotFoundPage(workspaceSlug?: string): Response {
  const slugLine = workspaceSlug
    ? `<p class="nf-text">No workspace found at <code>${escapeHtml(workspaceSlug)}</code>. It may have been renamed, moved, or never existed.</p>`
    : `<p class="nf-text">This workspace may have been renamed, moved, or never existed.</p>`;

  const body = `<main class="nf-wrap">
  <div class="nf-brand">${brandLockupHtml({ markSize: 30, href: '/' })}</div>
  <div class="nf-code">404</div>
  <h1 class="nf-title">Workspace not found</h1>
  ${slugLine}
  <div class="nf-actions">
    <a class="so-c-btn so-c-btn--primary" href="/home">Go to my artifacts</a>
    <a class="so-c-btn so-c-btn--secondary" href="/create">Create with AI</a>
  </div>
</main>`;

  return renderHtmlPage({
    title: 'Workspace not found · ShareOut',
    description: 'The workspace you are looking for could not be found.',
    pageStyles: notFoundStyles,
    body,
    status: 404,
    cacheControl: 'no-cache',
  });
}
