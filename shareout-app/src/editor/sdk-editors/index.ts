// ShareOut Visual Editor - SDK Object Editors

import type { SDKComponentType } from '../types';
import { createLogger, logError } from '../../logging';
import { handleAgentEditor } from './agent-editor';
import { handleBindingEditor } from './binding-editor';
import { handleBlobsEditor } from './blobs-editor';
import { handleCollaboratorsEditor } from './collaborators-editor';
import { handleCommentsEditor } from './comments-editor';
import { handleGithubEditor } from './github-editor';
import { handleJSONEditor } from './json-editor';
import { handleRealtimeEditor } from './realtime-editor';
import { handleSheetsEditor } from './sheets-editor';
import { handleSlidesEditor } from './slides-editor';
import { handleTableEditor } from './table-editor';
import { errorResponse } from './response';
import type { SDKEditorContext, SDKEditorHandler } from './types';

export type { SDKEditorContext } from './types';

const SDK_EDITORS: Record<SDKComponentType, SDKEditorHandler> = {
  json: handleJSONEditor,
  table: handleTableEditor,
  blobs: handleBlobsEditor,
  comments: handleCommentsEditor,
  realtime: handleRealtimeEditor,
  sheets: handleSheetsEditor,
  github: handleGithubEditor,
  collaborators: handleCollaboratorsEditor,
  agent: handleAgentEditor,
  slides: handleSlidesEditor,
  binding: handleBindingEditor,
};

// Mutations to connectors, the visitor agent, and collaborator membership are
// owner-only; reads ('get') stay available to editors.
const OWNER_ONLY_WRITE: ReadonlySet<SDKComponentType> = new Set<SDKComponentType>([
  'collaborators', 'agent', 'sheets', 'github', 'realtime',
]);

export async function handleSDKEditor(
  request: Request,
  ctx: SDKEditorContext,
  path: string
): Promise<Response> {
  const parts = path.split('/').filter(Boolean);
  const sdkType = parts[0] as SDKComponentType;
  const action = parts[1] || 'get';

  const handler = SDK_EDITORS[sdkType];
  if (!handler) {
    return errorResponse('INVALID_SDK_TYPE', `Unknown SDK type: ${sdkType}`, 400);
  }

  if (OWNER_ONLY_WRITE.has(sdkType) && action !== 'get' && ctx.role !== 'owner') {
    return errorResponse('FORBIDDEN', 'Only the artifact owner can change this setting', 403);
  }

  try {
    return await handler(request, ctx, action);
  } catch (err) {
    const logger = createLogger(ctx.env, {
      event: 'editor.sdk_editor_error',
      artifact_id: ctx.artifactId,
      sdk_type: sdkType,
      action,
      user_id: ctx.userId,
    });
    logError(logger, 'SDK editor handler threw', err);
    return errorResponse('INTERNAL_ERROR', 'SDK editor failed', 500);
  }
}
