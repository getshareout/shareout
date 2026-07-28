/**
 * Admin portal page shell: sidebar layout, gate page, and confirm modal.
 */

import { renderHtmlPage } from '../../design-system/shell';
import { superadminPageStyles } from '../../design-system/pages/superadmin.css';
import { escapeHtml } from '../../html/utils';
import { brandLockupHtml } from '../../brand';
import type { ViewDef } from './config';
import { VIEWS, rangeButtons } from './config';

/** Full-page layout with sidebar navigation and content region. */
export function renderShell(email: string, view: ViewDef, rangeKey: string, content: string): string {
  const nav = VIEWS.map(
    (v) => `<a href="?view=${v.key}&range=${rangeKey}" class="sa-nav-item${v.key === view.key ? ' active' : ''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${v.icon}</svg>
      <span>${escapeHtml(v.title)}</span>
    </a>`
  ).join('');

  return `
  <div class="sa-layout">
    <aside class="sa-sidebar">
      <div class="sa-logo">${brandLockupHtml({ markSize: 26, href: '/admin' })}<span class="sa-pill">Admin</span></div>
      <nav class="sa-nav">${nav}</nav>
      <div class="sa-sidebar-foot">
        <div class="sa-sidebar-email" title="${escapeHtml(email)}">${escapeHtml(email)}</div>
        <a href="/auth/logout?redirect=/" class="sa-signout">Sign out</a>
      </div>
    </aside>
    <main class="sa-main">
      <header class="sa-topbar">
        <h1 id="sa-title">${escapeHtml(view.title)}</h1>
        <div id="sa-rangebar">${view.range ? rangeButtons(view.key, rangeKey) : ''}</div>
      </header>
      <div class="sa-content" id="sa-content">${content}</div>
    </main>
  </div>

  <div class="so-c-modal-overlay" id="sa-modal-bg">
    <div class="so-c-modal">
      <div class="so-c-modal__body">
        <h3 id="sa-modal-title"></h3>
        <div id="sa-modal-body"></div>
      </div>
      <div class="so-c-modal__foot">
        <button class="so-c-btn so-c-btn--secondary" id="sa-modal-cancel">Cancel</button>
        <button class="so-c-btn so-c-btn--danger-outline" id="sa-modal-confirm">Confirm</button>
      </div>
    </div>
  </div>`;
}

/** 403 page shown when the visitor is not a platform owner. */
export function gatePage(): Response {
  return renderHtmlPage({
    title: 'ShareOut · Admin',
    pageStyles: superadminPageStyles,
    status: 403,
    body: `<div class="sa-gate">
      <div class="sa-gate-brand">${brandLockupHtml({ markSize: 34 })}</div>
      <h1>Admin access required</h1>
      <p>This portal is restricted to ShareOut platform owners.</p>
      <p><a href="/auth/login?redirect=/admin">Sign in with an authorized account</a></p>
    </div>`,
  });
}
