import type { Env } from '../../types';
import type { ChatInboundEvent, ChatPlatform, ChatReplyPort, ChatSession } from '../types';
import { registerPlatform } from '../registry';
import {
  getLinkedUserId,
  getSelectedSlackWorkspace,
  setSelectedSlackWorkspace,
  unlinkSlackDm,
  parseSlackSessionKey,
} from './linking';
import { createSlackReplyPort } from './reply-port';
import { verifySlackRequest } from './verify';
import { getPlatformOrigin } from '../../config/origins';

export const slackPlatform: ChatPlatform = {
  id: 'slack',
  featureFlag: 'ai.slack_bot',

  async verifyWebhook(request, env) {
    if (!env.SLACK_SIGNING_SECRET) return false;
    const raw = await request.clone().text();
    return verifySlackRequest(request, env.SLACK_SIGNING_SECRET, raw);
  },

  async parseEvents(): Promise<ChatInboundEvent[]> {
    return [];
  },

  replyPort(env: Env, session: ChatSession): ChatReplyPort {
    const native = session.native as { teamId: string; userId: string; channelId: string };
    return createSlackReplyPort(env, {
      teamId: native.teamId,
      slackUserId: native.userId,
      channelId: native.channelId,
    });
  },

  async getLinkedUserId(env, session) {
    const parsed = parseSlackSessionKey(session.key.replace(/^slack:/, ''));
    if (!parsed) return null;
    return getLinkedUserId(env, parsed.teamId, parsed.userId);
  },

  async unlink(env, session) {
    const parsed = parseSlackSessionKey(session.key.replace(/^slack:/, ''));
    if (!parsed) return;
    await unlinkSlackDm(env, parsed.teamId, parsed.userId);
  },

  async getSelectedWorkspace(env, session) {
    const parsed = parseSlackSessionKey(session.key.replace(/^slack:/, ''));
    if (!parsed) return null;
    return getSelectedSlackWorkspace(env, parsed.teamId, parsed.userId);
  },

  async setSelectedWorkspace(env, session, ws) {
    const parsed = parseSlackSessionKey(session.key.replace(/^slack:/, ''));
    if (!parsed) return;
    await setSelectedSlackWorkspace(env, parsed.teamId, parsed.userId, ws);
  },

  settingsUrl(env) {
    return `${getPlatformOrigin(env)}/settings/slack`;
  },
};

registerPlatform(slackPlatform);
