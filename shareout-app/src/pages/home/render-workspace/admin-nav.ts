/**
 * Admin sidebar: topic groups, one entry per page. The client keeps the page → panels map
 * (AD_SECTIONS in client-script/home-views/admin.ts); every key here must exist there.
 */
import { ICON } from './constants';
import { svg } from './helpers';

const LOCK = '<rect x="4.5" y="11" width="15" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';
const CARD = '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>';
const GLOBE = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>';
const KEY = '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>';
const LIST = '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>';
const SLIDERS = '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>';
const CHAT = '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>';
const CHART = '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>';

/** [key, English label, icon path] — labels are the `admin.sec_<key>` copy. */
type AdminNavItem = [string, string, string];

export const ADMIN_NAV: { i18n: string; label: string; items: AdminNavItem[] }[] = [
  { i18n: 'admin.grpReports', label: 'Reports', items: [['summary', 'Summary', CHART]] },
  { i18n: 'admin.grpPeople', label: 'People', items: [['members', 'Members', ICON.crew], ['clients', 'Sharing', ICON.shared], ['support', 'Support', CHAT]] },
  { i18n: 'admin.grpContent', label: 'Content', items: [['artifacts', 'Artifacts', ICON.browse], ['automation', 'Automations', ICON.recent]] },
  { i18n: 'admin.grpMoney', label: 'AI & billing', items: [['billing', 'Billing', CARD], ['ai', 'AI & models', ICON.foryou]] },
  { i18n: 'admin.grpSecurity', label: 'Security', items: [['access', 'Access', LOCK], ['publishing', 'Publishing', GLOBE], ['tokens', 'Agent tokens', KEY], ['audit', 'Activity log', LIST]] },
  { i18n: 'admin.grpWorkspace', label: 'Workspace', items: [['general', 'General', SLIDERS], ['branding', 'Branding', ICON.assets], ['domains', 'Custom domain', ICON.link]] },
];

/** Pages only some admins may open: rendered hidden, shown by the client once the API says yes
 *  (Summary → GET /v1/workspaces/{ws}/summary/access). A group of only gated pages hides with them. */
export const ADMIN_GATED = ['summary'];

/** The sidebar's buttons; `members` is the page Admin opens on. */
export function adminNavHtml(): string {
  return ADMIN_NAV.map((g) => {
    const gatedGroup = g.items.every(([key]) => ADMIN_GATED.includes(key));
    return `<div class="wsx-adm__grp" data-i18n="${g.i18n}"${gatedGroup ? ` data-ad-gate="${g.items[0]![0]}" hidden` : ''}>${g.label}</div>`
    + g.items.map(([key, label, icon]) => {
      const on = key === 'members';
      const gate = ADMIN_GATED.includes(key) ? ` data-ad-gate="${key}" hidden` : '';
      return `<button class="wsx-adm__it${on ? ' is-on' : ''}" data-admin-tab="${key}" type="button"${on ? ' aria-current="page"' : ''}${gate}>${svg(icon)}`
        + `<span class="wsx-adm__lbl" data-i18n="admin.sec_${key}">${label}</span><span class="wsx-adm__bdg" data-ad-bdg="${key}" hidden></span></button>`;
    }).join('');
  }).join('');
}
