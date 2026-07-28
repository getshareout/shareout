/**
 * Small HTML fragment builders for the workspace rail and Brief widgets.
 */
import { escapeHtml } from '../../../html/utils';
import { ICON, type NavItem } from './constants';

export const svg = (path: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export function railNav(n: NavItem, active: boolean): string {
  const titleAttr = n.i18n ? ` data-i18n-title="${n.i18n}" title="${n.label}"` : ` title="${n.label}"`;
  const spanI18n = n.i18n ? ` data-i18n="${n.i18n}"` : '';
  if (n.kind === 'link') {
    return `<a class="wsx-lens" href="${escapeHtml(n.href || '#')}"${titleAttr}>${svg(ICON[n.icon])}<span${spanI18n}>${n.label}</span></a>`;
  }
  return `<button class="wsx-lens${active ? ' is-active' : ''}" data-lens="${n.key}" type="button"${titleAttr}>${svg(ICON[n.icon])}<span${spanI18n}>${n.label}</span></button>`;
}

export const GRIP_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>`;
const TABLE_ICON = svg('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>');
/** Tile/table segmented toggle for artifact widgets (id ties it to the body element). */
export function viewSeg(id: string): string {
  return `<div class="wsx-viewseg" data-viewseg-for="${id}"><button data-vw="tile" class="is-on" type="button" data-i18n-title="viewseg.tiles" data-i18n-aria="viewseg.tiles" title="Tiles" aria-label="Tile view">${svg(ICON.browse)}</button><button data-vw="table" type="button" data-i18n-title="viewseg.table" data-i18n-aria="viewseg.table" title="Table" aria-label="Table view">${TABLE_ICON}</button></div>`;
}


export function widget(id: string, titleKey: string, title: string, icon: keyof typeof ICON, wide = false, artifacts = false): string {
  return `<section class="wsx-widget${wide ? ' wsx-widget--wide' : ''}" data-wid="${id}">
    <div class="wsx-widget__head"><button class="wsx-widget__grip" type="button" data-i18n-aria="widget.drag" data-i18n-title="widget.drag" aria-label="Drag to reorder" title="Drag to reorder">${GRIP_SVG}</button>${svg(ICON[icon])}<span data-i18n="${titleKey}">${title}</span><span class="wsx-widget__count" id="${id}Count"></span>${artifacts ? viewSeg(id) : ''}</div>
    <div class="wsx-widget__body" id="${id}"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
    <span class="wsx-widget__rz" aria-hidden="true"></span>
  </section>`;
}
