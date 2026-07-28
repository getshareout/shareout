/**
 * Persist AI-proposed edits until the user accepts or rejects them in the editor.
 */

import type { Env } from '../../types';
import type { EditorChatResponse } from '../types';
import { generateId } from '../../crypto-utils';
import { storeConversationTurn } from './history';

export async function storePendingChange(
  env: Env,
  artifactId: string,
  userId: string,
  mode: string,
  response: EditorChatResponse,
  userPrompt?: string
): Promise<string> {
  const changeId = generateId('chg');

  await env.DB.prepare(`
    INSERT INTO editor_pending_changes (id, artifact_id, user_id, change_type, change_data, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).bind(
    changeId,
    artifactId,
    userId,
    response.type,
    JSON.stringify(response)
  ).run();

  if (mode === 'normal' && userPrompt) {
    await storeConversationTurn(env, artifactId, userId, userPrompt, response.message || '');
  }

  return changeId;
}
