import type { ToolbarRenderContext } from '../types';
import { renderToolbarScriptCore } from './script-core';
import { renderToolbarScriptDrag } from './script-drag';
import { renderToolbarScriptAuth } from './script-auth';
import { renderToolbarScriptComments } from './script-comments';
import { renderToolbarScriptAdmin } from './script-admin';

/** Assembles conditional client-side scripts for the viewer toolbar. */
export function renderToolbarScript(ctx: ToolbarRenderContext): string {
  const { loggedIn, adminInfo, commentsEnabled, baseUrl, slug, artifactId } = ctx;
  const sections = [renderToolbarScriptCore(), renderToolbarScriptDrag(artifactId)];
  if (loggedIn || adminInfo) sections.push(renderToolbarScriptAuth(baseUrl, artifactId, ctx.currentUser?.email || ''));
  if (loggedIn && commentsEnabled) sections.push(renderToolbarScriptComments(baseUrl, artifactId));
  if (adminInfo) sections.push(renderToolbarScriptAdmin(baseUrl, slug, artifactId));

  return `
  <script>
  (function() {
${sections.join('\n')}
  })();
  </script>`;
}
