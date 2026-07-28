import type { Env } from '../../types';
import type { ArtifactCardItem } from '../types';
import { getPlatformOrigin } from '../../config/origins';

function artifactUrl(env: Env, slug: string): string {
  const base = getPlatformOrigin(env);
  return `${base.replace(/\/$/, '')}/a/${slug}/`;
}

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

export type TelegramCallbackButton = { text: string; callback_data: string } | { text: string; url: string };

export function artifactCardButtons(env: Env, item: ArtifactCardItem): TelegramCallbackButton[][] {
  return [
    [{ text: 'Open Page', url: artifactUrl(env, item.slug) }],
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
