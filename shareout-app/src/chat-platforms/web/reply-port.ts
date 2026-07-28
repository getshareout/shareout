import type { Env } from '../../types';
import type { ArtifactCardItem, ChatReplyPort, ChatUiAction } from '../types';
import type { ActionCard } from '../../chat-agent/actions';
import { generateId } from '../../crypto-utils';

/** R2 key prefix for short-lived agent media. A bucket lifecycle rule can expire this prefix. */
export const AGENT_MEDIA_PREFIX = 'agent-media';

export function agentMediaKey(userId: string, token: string): string {
  return `${AGENT_MEDIA_PREFIX}/${userId}/${token}`;
}

/** One streamed chunk the web client renders. The endpoint serializes these as SSE events. */
export type WebAgentEvent =
  | { type: 'typing' }
  | { type: 'delta'; text: string }
  | { type: 'text'; text: string }
  | { type: 'cards'; items: ArtifactCardItem[] }
  | { type: 'media'; token: string; mime: string; filename: string; caption?: string }
  | { type: 'confirm'; prompt: string; token: string; card?: ActionCard }
  | { type: 'ui_action'; action: ChatUiAction }
  /** Adopt the server-created thread for this turn (first chat in a new thread). */
  | { type: 'thread'; id: string; title: string }
  /** A confirmed build's progress step (emitted on the /confirm SSE stream). */
  | { type: 'build_step'; label: string }
  /** A confirmed build finished — identity for the "Open page" affordance. */
  | { type: 'build_done'; text: string; url?: string; slug?: string; artifactId?: string; name: string };

/**
 * A ChatReplyPort for the web home assistant. Side outputs (typing, media, cards,
 * confirmations) are pushed through `emit` as SSE events; media bytes are parked in
 * R2 under a user-namespaced key and fetched back through an authenticated serve route.
 */
export function createWebReplyPort(env: Env, userId: string, emit: (ev: WebAgentEvent) => void): ChatReplyPort {
  async function park(bytes: ArrayBuffer, mime: string, filename: string, caption?: string): Promise<boolean> {
    const token = generateId('med');
    await env.ARTIFACTS.put(agentMediaKey(userId, token), bytes, { httpMetadata: { contentType: mime } });
    emit({ type: 'media', token, mime, filename, caption });
    return true;
  }

  return {
    async sendText(text) {
      emit({ type: 'text', text });
    },
    async sendTextDelta(text) {
      emit({ type: 'delta', text });
    },
    async sendTyping() {
      emit({ type: 'typing' });
    },
    async sendImage(bytes, filename, caption) {
      return park(bytes, 'image/png', filename, caption);
    },
    async sendFile(bytes, filename, mime, caption) {
      return park(bytes, mime, filename, caption);
    },
    async sendArtifactCards(items) {
      emit({ type: 'cards', items });
    },
    async sendUiAction(action) {
      emit({ type: 'ui_action', action });
    },
    async askConfirmation(prompt, token) {
      emit({ type: 'confirm', prompt, token });
      return undefined;
    },
  };
}
