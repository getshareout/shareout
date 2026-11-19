import type { Env } from '../../types';
import type { ChatReplyPort } from '../types';
import type { WhatsAppMeter } from './metering';
import {
  markWhatsAppReadTyping,
  sendWhatsAppButtons,
  sendWhatsAppDocument,
  sendWhatsAppImage,
  sendWhatsAppText,
  type WhatsAppTarget,
} from '../../whatsapp/client';
import { artifactListText, whatsappText } from './format';
import { artifactLink } from '../../artifacts/page-links';
import { t, type Locale } from '../../i18n';

const CONFIRM_COPY = {
  en: { confirm: '✅ Confirm', cancel: '❌ Cancel' },
  es: { confirm: '✅ Confirmar', cancel: '❌ Cancelar' },
};

/**
 * A ChatReplyPort on WhatsApp for one person. Every message is billed, so the agent's answer
 * goes out once when it is done (no streaming, no "working on it" lines, no edits) and a page
 * list is a single message.
 */
export function createWhatsAppReplyPort(
  env: Env,
  opts: { to: string; meter: WhatsAppMeter; inboundMessageId?: string; locale?: Locale },
): ChatReplyPort {
  const target: WhatsAppTarget = { to: opts.to, meter: opts.meter };
  return {
    async sendText(text) {
      await sendWhatsAppText(env, target, whatsappText(text));
    },

    async sendTyping() {
      if (opts.inboundMessageId) await markWhatsAppReadTyping(env, opts.inboundMessageId);
    },

    sendImage(bytes, filename, caption) {
      return sendWhatsAppImage(env, target, bytes, filename, caption);
    },

    sendFile(bytes, filename, mime, caption) {
      return sendWhatsAppDocument(env, target, bytes, filename, mime, caption);
    },

    async sendArtifactCards(items) {
      if (!items.length) return;
      await sendWhatsAppText(env, target, artifactListText('', items, (slug) => artifactLink(env, slug)).trimStart());
    },

    async askConfirmation(prompt, token) {
      const copy = t(opts.locale, CONFIRM_COPY);
      return sendWhatsAppButtons(env, target, whatsappText(prompt), [
        { id: `ok:${token}`, title: copy.confirm },
        { id: `no:${token}`, title: copy.cancel },
      ]);
    },

    // WhatsApp has no tap acknowledgement and no message edits; skipping them saves a billed message.
  };
}
