import type { Locale } from './locale';

/** How the product's Spanish sounds, for any model writing it (rioplatense, voseo). */
export const ES_AR_VOICE = 'Spanish as spoken in Argentina (use vos), and call pages "páginas"';

/** Language rule for an agent's system prompt: mirror the user, lean on the workspace's language. */
export function agentLanguageRule(locale: Locale | null | undefined): string {
  return locale === 'es'
    ? `Reply in the language the user writes in; when unsure, use Spanish — this workspace speaks it. When you write Spanish, write ${ES_AR_VOICE} (artifacts are "páginas"), in plain words with no anglicisms.`
    : 'Reply in the language the user writes in.';
}
