/**
 * The reinvented workspace — a WorkHub Station / Studio (not a SaaS site or Drive).
 *
 * Server-side entry point for the workspace home shell (default home; `?next=0` for legacy).
 * Styles, HTML template, and client hydration are split across submodules.
 */
import type { RenderArgs } from '../types';
import { getHomeI18nScript } from '../home-i18n';
import { WORKSPACE_CLIENT } from './client-script';
import { buildWorkspaceBody, canManageWorkspace } from './template';

export { WORKSPACE_STYLES } from './styles';

/** SSR body + inline script bundle for the workspace home shell. */
export function buildWorkspaceView(args: RenderArgs): { body: string; scripts: string } {
  const wsParam = args.workspaceId || args.workspace || '';
  const wsSlug = args.workspaces.find(w => w.id === wsParam)?.slug || '';
  const canManage = canManageWorkspace(args);
  const firstName = (args.userInfo?.name || '').trim().split(/\s+/)[0] || '';
  const body = buildWorkspaceBody(args);
  const scripts = `${getHomeI18nScript()}\nwindow.WSX_WS=${JSON.stringify(wsParam)};window.WSX_SLUG=${JSON.stringify(wsSlug)};window.WSX_ADMIN=${canManage ? 'true' : 'false'};window.WSX_NAME=${JSON.stringify(firstName)};window.WSX_KNOWLEDGE_PAID=${args.wsKnowledgePaid ? 'true' : 'false'};window.WSX_INBOX_DOMAIN=${JSON.stringify(args.inboxDomain || '')};window.WSX_INSTANCE_ADMIN=${args.isInstanceAdmin ? 'true' : 'false'};\n${WORKSPACE_CLIENT}`;
  return { body, scripts };
}
