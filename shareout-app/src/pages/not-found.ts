/**
 * Styled 404 page — the design-system fallback for any unmatched route.
 */
import { renderHtmlPage } from '../design-system/shell';
import { brandLockupHtml } from '../brand';
import { escapeHtml } from '../html/utils';

const notFoundStyles = `
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

export function renderNotFoundPage(): Response {
  const body = `<main class="nf-wrap">
  <div class="nf-brand">${brandLockupHtml({ markSize: 30, href: '/' })}</div>
  <div class="nf-code">404</div>
  <h1 class="nf-title">This page wandered off</h1>
  <p class="nf-text">The link may be broken, or the page may have moved. Let's get you back to something live.</p>
  <div class="nf-actions">
    <a class="so-c-btn so-c-btn--primary" href="/home">Go to my artifacts</a>
    <a class="so-c-btn so-c-btn--secondary" href="/create">Create with AI</a>
  </div>
</main>`;

  return renderHtmlPage({
    title: 'Page not found · ShareOut',
    description: 'The page you are looking for could not be found.',
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
