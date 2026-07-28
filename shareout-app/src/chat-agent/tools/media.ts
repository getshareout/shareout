import type { Env } from '../../types';
import { resolveArtifactAccessForUser } from '../access';
import { renderArtifactImage, renderArtifactPdf } from '../../screenshots';
import { createTelegramReplyPort } from '../../chat-platforms/telegram/reply-port';
import type { ChatReplyPort } from '../../chat-platforms/types';
import type { AccountTool, ToolContext } from './types';

function resolveReply(ctx: ToolContext): ChatReplyPort | null {
  if (ctx.reply) return ctx.reply;
  if (ctx.platform === 'telegram' && ctx.chatId != null) {
    return createTelegramReplyPort(ctx.env, ctx.chatId);
  }
  return null;
}

async function artifactName(env: Env, artifactId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT name FROM artifacts WHERE id = ?')
    .bind(artifactId)
    .first<{ name: string }>();
  return row?.name?.trim() || 'page';
}

function safeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
}

export const sendSnapshotTool: AccountTool = {
  name: 'send_snapshot',
  description:
    'Render a page to an image and send it to the user in this chat. Use when they ask for a picture, screenshot, or snapshot of a page. Get the id from list_artifacts/search_artifacts first.',
  input_schema: {
    type: 'object',
    properties: { artifact_id: { type: 'string', description: 'The id of the page to snapshot.' } },
    required: ['artifact_id'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    if (!artifactId) return { error: 'Missing artifact_id.' };

    const access = await resolveArtifactAccessForUser(ctx.env, artifactId, ctx.userId);
    if (!access) return { error: 'You don’t have access to that page (or it doesn’t exist).' };

    const reply = resolveReply(ctx);
    if (!reply) return { error: 'No chat session to deliver to.' };

    const image = await renderArtifactImage(ctx.env, artifactId, { type: 'png', width: 1280, fullPage: true });
    if (!image) return { error: 'Couldn’t render that page right now.' };

    const name = await artifactName(ctx.env, artifactId);
    const file = `${safeFilename(name)}.png`;
    const sent = await reply.sendImage(image, file, name);
    return sent ? { sent: true, as: 'image' } : { error: 'Couldn’t send the image.' };
  },
};

export const sendPdfTool: AccountTool = {
  name: 'send_pdf',
  description:
    'Render a page to a PDF and send it to the user in this chat. Use when they ask for a PDF or printable version of a page. Get the id from list_artifacts/search_artifacts first.',
  input_schema: {
    type: 'object',
    properties: { artifact_id: { type: 'string', description: 'The id of the page to export as PDF.' } },
    required: ['artifact_id'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    if (!artifactId) return { error: 'Missing artifact_id.' };

    const access = await resolveArtifactAccessForUser(ctx.env, artifactId, ctx.userId);
    if (!access) return { error: 'You don’t have access to that page (or it doesn’t exist).' };

    const reply = resolveReply(ctx);
    if (!reply) return { error: 'No chat session to deliver to.' };

    const pdf = await renderArtifactPdf(ctx.env, artifactId);
    if (!pdf) return { error: 'Couldn’t render that page right now.' };

    const name = await artifactName(ctx.env, artifactId);
    const sent = await reply.sendFile(pdf, `${safeFilename(name)}.pdf`, 'application/pdf', name);
    return sent ? { sent: true, as: 'pdf' } : { error: 'Couldn’t send the PDF.' };
  },
};
