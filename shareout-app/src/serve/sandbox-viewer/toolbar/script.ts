import type { ToolbarRenderContext } from '../types';
import { renderToolbarScriptCore } from './script-core';
import { renderToolbarScriptDrag } from './script-drag';
import { renderToolbarScriptAuth } from './script-auth';
import { renderToolbarScriptComments } from './script-comments';
import { renderToolbarScriptAdmin } from './script-admin';
import { renderToolbarScriptPresence } from './script-presence';
import { shareModalScript } from '../../../components/share-modal';
import { TOOLBAR_COPY } from './copy';

/** Assembles conditional client-side scripts for the viewer toolbar. */
export function renderToolbarScript(ctx: ToolbarRenderContext): string {
  const { loggedIn, adminInfo, commentsEnabled, baseUrl, slug, artifactId, locale } = ctx;
  const c = TOOLBAR_COPY[locale];
  const sections = [renderToolbarScriptCore(c, locale), renderToolbarScriptDrag(artifactId, c)];
  if (loggedIn || adminInfo) sections.push(renderToolbarScriptAuth(baseUrl, artifactId, ctx.currentUser?.email || '', c));
  if (loggedIn) sections.push(shareModalScript({ baseUrl, locale }));
  if (loggedIn) sections.push(renderToolbarScriptPresence(baseUrl, artifactId, c));
  if (loggedIn && commentsEnabled) sections.push(renderToolbarScriptComments(baseUrl, artifactId, c, locale));
  if (adminInfo) sections.push(renderToolbarScriptAdmin(baseUrl, slug, artifactId));

  return `
  <script>
  (function() {
${sections.join('\n')}
  })();
  </script>`;
}
