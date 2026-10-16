import type { Env } from '../../types';
import type { ArtifactCardItem } from '../types';
import type { InlineButton } from '../../telegram/client';
import { artifactLink } from '../../artifacts/page-links';
import { openPageButton, ownArtifactPath } from '../../telegram/open-link';
import { t, type Locale } from '../../i18n';
import { TELEGRAM_LINK_COPY } from './copy';

function artifactTitle(item: ArtifactCardItem): string {
  return item.name?.trim() || item.slug;
}

export function artifactCardText(item: ArtifactCardItem): string {
  const updated = item.updated_at || item.created_at;
  const meta = [
    item.artifact_type || 'page',
    item.visibility,
    updated ? `updated ${updated.slice(0, 10)}` : '',
  ].filter(Boolean).join(' · ');
  return meta ? `${artifactTitle(item)}\n${meta}` : artifactTitle(item);
}

export type TelegramCallbackButton = InlineButton;

export async function artifactCardButtons(env: Env, item: ArtifactCardItem, userId: string | null = null, locale: Locale = 'en'): Promise<TelegramCallbackButton[][]> {
  return [
    [await openPageButton(env, userId, t(locale, TELEGRAM_LINK_COPY).openPage, artifactLink(env, item.slug))],
    [
      { text: 'Snapshot', callback_data: `snap:${item.id}` },
      { text: 'PDF', callback_data: `pdf:${item.id}` },
    ],
    [
      { text: 'Ask AI', callback_data: `ask:${item.id}` },
      { text: 'Share', callback_data: `share:${item.id}` },
    ],
  ];
}

export function confirmationButtons(token: string): TelegramCallbackButton[][] {
  return [
    [
      { text: '✅ Confirm', callback_data: `ok:${token}` },
      { text: '❌ Cancel', callback_data: `no:${token}` },
    ],
  ];
}

/**
 * Bot replies go out without parse_mode (plain text, so nothing needs escaping and a
 * stray `_` or `*` never breaks delivery). Telegram only auto-links BARE URLs, so the
 * Markdown a model may still write is flattened: `[label](url)` → `label: url`,
 * `<url>` → `url`, and `**bold**` loses its markers.
 */
export function telegramPlainText(text: string): string {
  return text
    .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
      label.trim() === url ? url : `${label.trim()}: ${url}`)
    .replace(/<(https?:\/\/[^\s>]+)>/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1');
}

const URL_RE = /https?:\/\/[^\s<>()"']+/g;
const MAX_OPEN_BUTTONS = 5;

/** This instance's page links in a reply, each with the words before it on its line as a label. */
export function pageLinksIn(env: Env, text: string): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(URL_RE)) {
      const url = m[0].replace(/[.,;:!?]+$/, '');
      if (!ownArtifactPath(env, url) || out.some((o) => o.url === url)) continue;
      const label = line.slice(0, m.index).replace(/^[\s\-•*\d.)]+/, '').replace(/[\s:—–-]+$/, '').trim();
      out.push({ label: label.slice(0, 60), url });
      if (out.length >= MAX_OPEN_BUTTONS) return out;
    }
  }
  return out;
}

/** One-tap open buttons for the page links in a reply (one row each). */
export async function openLinkButtons(env: Env, userId: string, text: string, locale: Locale): Promise<InlineButton[][]> {
  const copy = t(locale, TELEGRAM_LINK_COPY);
  const links = pageLinksIn(env, text);
  return Promise.all(links.map(async (l, i) => [await openPageButton(env, userId, l.label || copy.openN(i + 1), l.url)]));
}
