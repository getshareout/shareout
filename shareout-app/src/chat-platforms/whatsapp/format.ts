import type { ArtifactCardItem } from '../types';

/**
 * WhatsApp formats `*bold*`, `_italic_` and `~strike~`, and links bare URLs only. The Markdown
 * a model writes is converted: `[label](url)` → `label: url`, `<url>` → `url`, `**bold**` and
 * `# Heading` → `*bold*`.
 */
export function whatsappText(text: string): string {
  return text
    .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
      label.trim() === url ? url : `${label.trim()}: ${url}`)
    .replace(/<(https?:\/\/[^\s>]+)>/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
}

/**
 * A page list as ONE message (each WhatsApp message is billed): name, then its link.
 * `link` resolves a page's address on this instance.
 */
export function artifactListText(heading: string, items: ArtifactCardItem[], link: (slug: string) => string): string {
  const lines = items.map((item, i) => `${i + 1}. ${item.name?.trim() || item.slug}\n${link(item.slug)}`);
  return [heading, '', ...lines].join('\n');
}
