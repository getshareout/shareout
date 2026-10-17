/**
 * The reinvented workspace — a WorkHub Station / Studio (not a SaaS site or Drive).
 *
 * Server-side entry point for the workspace home shell (default home; `?next=0` for legacy).
 * Styles, HTML template, and client hydration are split across submodules.
 */
import type { RenderArgs } from '../types';
import { getHomeI18nScript } from '../home-i18n/runtime';
import { WORKSPACE_CLIENT } from './client-script';
import { buildWorkspaceBody, canManageWorkspace } from './template';

export { WORKSPACE_STYLES } from './styles';

/**
 * SSR body + script for the workspace home shell. `scripts` is the whole inline boot bundle
 * (i18n, window.WSX_* globals, WORKSPACE_CLIENT; lazy lens chunks excluded). `bootScript` is only the per-request
 * globals (incl. WSX_LOCALE): the page inlines it and loads the static rest
 * (getStaticHomeI18nScript + WORKSPACE_CLIENT) as one cached file (shell-assets).
 */
export function buildWorkspaceView(args: RenderArgs): { body: string; scripts: string; bootScript: string } {
  const wsParam = args.workspaceId || args.workspace || '';
  const wsSlug = args.workspaces.find(w => w.id === wsParam)?.slug || '';
  const canManage = canManageWorkspace(args);
  const firstName = (args.userInfo?.name || '').trim().split(/\s+/)[0] || '';
  const body = buildWorkspaceBody(args);
  const globals = `window.WSX_WS=${JSON.stringify(wsParam)};window.WSX_SLUG=${JSON.stringify(wsSlug)};window.WSX_ADMIN=${canManage ? 'true' : 'false'};window.WSX_NAME=${JSON.stringify(firstName)};window.WSX_UK=${JSON.stringify(args.user?.id || '')};window.WSX_KNOWLEDGE_PAID=${args.wsKnowledgePaid ? 'true' : 'false'};window.WSX_INBOX_DOMAIN=${JSON.stringify(args.inboxDomain || '')};window.WSX_INSTANCE_ADMIN=${args.isInstanceAdmin ? 'true' : 'false'};window.WSX_ORIGIN=${JSON.stringify(args.platformOrigin || '')};window.WSX_SLIDES=${args.slidesImport ? 'true' : 'false'};window.WSX_FILE_IMPORT=${JSON.stringify(wsParam ? args.fileImportProviders || [] : [])};\n`;
  return {
    body,
    // Built on read: the page only uses bootScript, and this is ~1 MB of concatenation.
    get scripts() { return `${getHomeI18nScript(args.locale)}\n${globals}${WORKSPACE_CLIENT}`; },
    bootScript: `window.WSX_LOCALE=${JSON.stringify(args.locale ?? null)};${globals}`,
  };
}
