/**
 * Superadmin portal entry point.
 *
 * Full page: `handleSuperAdminPage` → shell + client script.
 * Fragment API: `renderAdminFragment` → inner HTML for SPA navigation.
 *
 * Implementation is split under `./views/` — config, shell, components, per-view bodies,
 * table rows (re-exported for the REST API), and client-side script.
 */

import type { Env } from '../types';
import { renderHtmlPage } from '../design-system/shell';
import { superadminPageStyles } from '../design-system/pages/superadmin.css';
import { requireSuperAdmin } from './auth';
import { DEFAULT_RANGE, RANGES, VIEWS, rangeButtons, resolveRange, resolveView } from './views/config';
import { gatePage, renderShell } from './views/shell';
import { pageScript } from './views/client-script';
import { renderView } from './views/render';

// Re-export row renderers used by `/v1/admin/users` and `/v1/admin/artifacts` search API.
export { userRow, artifactRow } from './views/rows';

/** One view's content for client-side navigation (`GET /v1/admin/view`). */
export async function renderAdminFragment(
  env: Env,
  viewKey: string,
  rangeKey: string
): Promise<{ view: string; title: string; rangeBar: string; html: string }> {
  const view = VIEWS.find((v) => v.key === viewKey) || VIEWS[0];
  const range = RANGES.find((r) => r.key === rangeKey) || DEFAULT_RANGE;
  const html = await renderView(env, view.key, range);
  return {
    view: view.key,
    title: view.title,
    rangeBar: view.range ? rangeButtons(view.key, range.key) : '',
    html,
  };
}

/** Full HTML page at `/admin`. */
export async function handleSuperAdminPage(request: Request, env: Env): Promise<Response> {
  const admin = await requireSuperAdmin(request, env);
  if (!admin) return gatePage();

  const url = new URL(request.url);
  const view = resolveView(url);
  const range = resolveRange(url);

  const content = await renderView(env, view.key, range);

  return renderHtmlPage({
    title: `ShareOut Admin · ${view.title}`,
    pageStyles: superadminPageStyles,
    body: renderShell(admin.email, view, range.key, content),
    bodyClass: 'so-theme-admin',
    scripts: pageScript(view.key, range.key),
  });
}
