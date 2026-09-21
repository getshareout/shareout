/**
 * Render skill markdown to HTML that is safe to drop into the app's own DOM.
 *
 * `src/viewers/markdown-viewer.ts` cannot be reused here. It passes raw HTML in the
 * source straight through, which is fine where it runs — a published artifact served
 * from the sandboxed artifact origin — and a stored XSS here, because the Library
 * viewer renders inside the Studio, same origin as the session cookie, and any
 * workspace member can publish a skill.
 *
 * The rule that makes this safe is escape-once-first: the whole source is escaped
 * before a single tag is produced, and nothing below ever escapes again. Every `<`
 * in the output is therefore one this file wrote.
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) and anchors survive — `javascript:` and `data:` never become links. */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href.startsWith('#') || href.startsWith('/')) return href;
  return /^https?:\/\//i.test(href) ? href : null;
}

const CODE_PLACEHOLDER = '\u0000CODE';

export function renderSkillHtml(markdown: string): string {
  // Frontmatter is metadata, not body — the viewer shows it as chips.
  const source = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  // Escape first. From here on the text contains no author-controlled markup.
  let html = escapeHtml(source);

  // Park fenced blocks so inline rules do not rewrite code.
  const blocks: string[] = [];
  html = html.replace(/```(\w*)\r?\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const cls = /^[a-z0-9+-]{0,20}$/i.test(lang) ? lang : '';
    blocks.push(`<pre><code${cls ? ` class="language-${cls}"` : ''}>${code.replace(/\s+$/, '')}</code></pre>`);
    return `${CODE_PLACEHOLDER}${blocks.length - 1}\u0000`;
  });

  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, text: string) =>
    `<h${hashes.length}>${text.trim()}</h${hashes.length}>`);
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  html = html.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text: string, href: string) => {
    const safe = safeHref(href);
    return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>` : m;
  });

  html = html.replace(/^\s*(?:---|\*\*\*|___)\s*$/gm, '<hr>');
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
  html = html.replace(/^\s*[-*+]\s+(.*)$/gm, '<li>$1</li>');
  html = html.replace(/^\s*\d+\.\s+(.*)$/gm, '<li>$1</li>');
  html = html.replace(/(?:<li>.*<\/li>\n?)+/g, (m) => `<ul>${m.replace(/\n/g, '')}</ul>`);

  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const t = block.trim();
      if (!t) return '';
      if (t.startsWith(CODE_PLACEHOLDER) || /^<(h[1-6]|ul|blockquote|hr|pre)/.test(t)) return t;
      return `<p>${t.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return html.replace(new RegExp(`${CODE_PLACEHOLDER}(\\d+)\u0000`, 'g'), (_m, i: string) => blocks[Number(i)] ?? '');
}
