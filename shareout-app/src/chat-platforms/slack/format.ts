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
  return `*${artifactTitle(item)}*${meta ? `\n${meta}` : ''}`;
}

export function artifactCardBlocks(env: Env, item: ArtifactCardItem): unknown[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: artifactCardText(item) } },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Open Page' }, url: artifactUrl(env, item.slug) },
        { type: 'button', text: { type: 'plain_text', text: 'Snapshot' }, action_id: 'shareout_action', value: `snap:${item.id}` },
        { type: 'button', text: { type: 'plain_text', text: 'PDF' }, action_id: 'shareout_action', value: `pdf:${item.id}` },
        { type: 'button', text: { type: 'plain_text', text: 'Ask AI' }, action_id: 'shareout_action', value: `ask:${item.id}` },
      ],
    },
  ];
}

export function confirmationBlocks(prompt: string, token: string): unknown[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: prompt } },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Confirm' }, style: 'primary', action_id: 'shareout_confirm', value: `ok:${token}` },
        { type: 'button', text: { type: 'plain_text', text: 'Cancel' }, action_id: 'shareout_confirm', value: `no:${token}` },
      ],
    },
  ];
}
