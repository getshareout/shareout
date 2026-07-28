import type { Env } from '../../types';
import type { ArtifactCardItem, ChatReplyPort } from '../types';
import { getSlackLink } from './linking';
import { openDmChannel, postSlackMessage, resolveSlackToken, slackPost, uploadFileToSlack } from './client';
import { artifactCardBlocks, artifactCardText, confirmationBlocks } from './format';

export interface SlackReplyContext {
  teamId: string;
  slackUserId: string;
  /** DM channel id from the inbound event (conversations.open fallback). */
  channelId: string;
}

async function resolveToken(env: Env, ctx: SlackReplyContext): Promise<string | null> {
  const link = await getSlackLink(env, ctx.teamId, ctx.slackUserId);
  if (!link?.connection_name || !link.selected_workspace_id) return null;
  const resolved = await resolveSlackToken(env, link.selected_workspace_id, link.connection_name);
  return resolved?.token ?? null;
}

async function ensureChannel(token: string, ctx: SlackReplyContext): Promise<string | null> {
  if (ctx.channelId) return ctx.channelId;
  const dm = await openDmChannel(token, ctx.slackUserId);
  return dm.channelId ?? null;
}

/** Build a ChatReplyPort backed by Slack Web API for one DM session. */
export function createSlackReplyPort(env: Env, ctx: SlackReplyContext): ChatReplyPort {
  return {
    async sendText(text) {
      const token = await resolveToken(env, ctx);
      if (!token) return;
      const channel = await ensureChannel(token, ctx);
      if (!channel) return;
      await postSlackMessage(token, channel, text);
    },

    async sendTyping() {
      // Slack has no lightweight typing indicator for bot DMs in our scope set.
    },

    async sendImage(bytes, filename, caption) {
      const token = await resolveToken(env, ctx);
      if (!token) return false;
      const channel = await ensureChannel(token, ctx);
      if (!channel) return false;
      const uploaded = await uploadFileToSlack(token, channel, bytes, filename, 'image/png', filename, caption);
      return uploaded.ok;
    },

    async sendFile(bytes, filename, mime, caption) {
      const token = await resolveToken(env, ctx);
      if (!token) return false;
      const channel = await ensureChannel(token, ctx);
      if (!channel) return false;
      const uploaded = await uploadFileToSlack(token, channel, bytes, filename, mime, filename, caption);
      return uploaded.ok;
    },

    async sendArtifactCards(items: ArtifactCardItem[]) {
      const token = await resolveToken(env, ctx);
      if (!token) return;
      const channel = await ensureChannel(token, ctx);
      if (!channel) return;
      for (const item of items) {
        const blocks = artifactCardBlocks(env, item);
        await postSlackMessage(token, channel, artifactCardText(item), blocks);
      }
    },

    async askConfirmation(prompt, tokenValue) {
      const token = await resolveToken(env, ctx);
      if (!token) return null;
      const channel = await ensureChannel(token, ctx);
      if (!channel) return null;
      const result = await postSlackMessage(token, channel, prompt, confirmationBlocks(prompt, tokenValue));
      return result.ts ?? null;
    },

    async answerCallback() {
      // Slack interactivity ack is handled at the HTTP layer.
    },

    async editConfirmation(messageRef, prompt) {
      const token = await resolveToken(env, ctx);
      if (!token) return;
      const channel = await ensureChannel(token, ctx);
      if (!channel) return;
      const ts = typeof messageRef === 'string' ? messageRef : null;
      if (!ts) return;
      await slackPost(token, 'chat.update', {
        channel,
        ts,
        text: prompt,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: prompt } }],
      });
    },
  };
}
