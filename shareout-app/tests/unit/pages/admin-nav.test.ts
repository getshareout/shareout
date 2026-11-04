// The Admin sidebar (server-rendered, admin-nav.ts) and the client's page → panels map
// (AD_SECTIONS in admin.ts) are two lists that must agree, or a sidebar entry opens nothing.
import { describe, expect, it } from 'vitest';
import { ADMIN_GATED, ADMIN_NAV, adminNavHtml } from '../../../src/pages/home/render-workspace/admin-nav';
import { workspace_client_home_views_adminCore_JS as core, workspace_client_home_views_admin_JS as lazy } from '../../../src/pages/home/render-workspace/client-script/home-views/admin';
import { ADMIN_PAGE_COPY } from '../../../src/pages/home/render-workspace/client-script/home-views/admin-page-copy';
import { ADMIN_COPY } from '../../../src/pages/home/home-i18n/copy/admin';

const objLiteral = (src: string, name: string): Record<string, unknown> => {
  const m = src.match(new RegExp(`var ${name} = (\\{[^;]*\\});`));
  if (!m) throw new Error(`${name} not found`);
  return new Function(`return ${m[1]}`)() as Record<string, unknown>;
};
const sections = objLiteral(core, 'AD_SECTIONS') as Record<string, string[]>;
const alias = objLiteral(core, 'AD_ALIAS') as Record<string, string>;
const navKeys = ADMIN_NAV.flatMap((g) => g.items.map(([k]) => k));
const painters = (() => {
  const m = lazy.match(/var fnMap = \{([^}]*)\}/);
  return new Set([...(m?.[1] ?? '').matchAll(/(\w+):\s*ad\w+/g)].map((x) => x[1]));
})();

describe('Admin sidebar', () => {
  it('has one page per sidebar entry, and no page without an entry', () => {
    expect(navKeys.slice().sort()).toEqual(Object.keys(sections).sort());
  });

  it('every page paints only panels that exist', () => {
    for (const [k, panels] of Object.entries(sections)) {
      expect(panels.length, k).toBeGreaterThan(0);
      for (const p of panels) expect(painters.has(p), `${k} → ${p}`).toBe(true);
    }
  });

  it('old tab keys from links and ⌘K still land on a page', () => {
    for (const old of ['overview', 'people', 'usage', 'security', 'settings', 'billing', 'members', 'artifacts', 'automation', 'ai', 'domains', 'support', 'clients']) {
      const target = sections[old] ? old : alias[old];
      expect(sections[target!], old).toBeDefined();
    }
  });

  it('every page has a title and a one-line description in both languages', () => {
    for (const l of ['en', 'es'] as const) {
      for (const k of navKeys) {
        expect(ADMIN_COPY[l][`admin.sec_${k}`], `${l} sec_${k}`).toBeTruthy();
        expect(ADMIN_PAGE_COPY[l][`admin.secd_${k}`], `${l} secd_${k}`).toBeTruthy();
      }
      for (const g of ADMIN_NAV) expect(ADMIN_COPY[l][g.i18n], `${l} ${g.i18n}`).toBeTruthy();
    }
    expect(Object.keys(ADMIN_PAGE_COPY.es).sort()).toEqual(Object.keys(ADMIN_PAGE_COPY.en).sort());
  });

  it('renders Members as the open page and a hidden badge slot per entry', () => {
    const html = adminNavHtml();
    expect(html.match(/data-admin-tab=/g)).toHaveLength(navKeys.length);
    expect(html.match(/data-ad-bdg="[a-z]+" hidden/g)).toHaveLength(navKeys.length);
    expect(html).toMatch(/class="wsx-adm__it is-on" data-admin-tab="members"[^>]*aria-current="page"/);
  });

  it('renders Summary (and its Reports heading) hidden until the API says this person may open it', () => {
    const html = adminNavHtml();
    expect(ADMIN_GATED).toEqual(['summary']);
    expect(html).toMatch(/<div class="wsx-adm__grp" data-i18n="admin.grpReports" data-ad-gate="summary" hidden>/);
    expect(html).toMatch(/data-admin-tab="summary" type="button" data-ad-gate="summary" hidden>/);
    expect(html.match(/data-ad-gate=/g)).toHaveLength(2);
  });
});
