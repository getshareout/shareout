import { generateViewerShell, type ViewerContext } from './viewer-shell';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarkdownViewer(ctx: ViewerContext): string {
  const metadata = ctx.typeMetadata.markdown;
  const html = parseMarkdown(ctx.content);

  const tocHtml = metadata?.toc?.length ? `
    <nav class="toc">
      <h3 class="toc-title">Contents</h3>
      <ul class="toc-list">
        ${metadata.toc.map(item => `
          <li class="toc-item toc-level-${item.level}">
            <a href="#${item.anchor}">${escapeHtml(item.text)}</a>
          </li>
        `).join('')}
      </ul>
    </nav>
  ` : '';

  const bodyContent = `
    <div class="markdown-viewer">
      <div class="layout">
        ${tocHtml}
        <article class="content">
          ${html}
        </article>
      </div>
    </div>
  `;

  const extraStyles = MARKDOWN_VIEWER_STYLES;

  return generateViewerShell(ctx, bodyContent, undefined, extraStyles);
}

export const MARKDOWN_VIEWER_STYLES = `
    .markdown-viewer {
      height: 100%;
    }
    .layout {
      display: flex;
      gap: 32px;
      max-width: 1200px;
      margin: 0 auto;
    }
    .toc {
      width: 220px;
      flex-shrink: 0;
      position: sticky;
      top: 20px;
      max-height: calc(100vh - 120px);
      overflow-y: auto;
    }
    .toc-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 12px;
    }
    .toc-list {
      list-style: none;
      font-size: 13px;
    }
    .toc-item {
      margin-bottom: 6px;
    }
    .toc-item a {
      color: var(--text-muted);
      text-decoration: none;
      display: block;
      padding: 4px 8px;
      border-radius: 4px;
      transition: all 0.15s;
    }
    .toc-item a:hover {
      color: var(--text);
      background: var(--code-bg);
    }
    .toc-level-1 { padding-left: 0; }
    .toc-level-2 { padding-left: 12px; }
    .toc-level-3 { padding-left: 24px; }
    .toc-level-4 { padding-left: 36px; }
    .content {
      flex: 1;
      min-width: 0;
      background: var(--surface);
      padding: 32px;
      border-radius: 12px;
      border: 1px solid var(--border);
    }
    @media (max-width: 768px) {
      .layout { flex-direction: column; }
      .toc { width: 100%; position: static; max-height: none; margin-bottom: 24px; }
    }
    /* Markdown styles */
    .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      font-weight: 600;
      line-height: 1.3;
    }
    .content h1:first-child { margin-top: 0; }
    .content h1 { font-size: 2em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
    .content h2 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
    .content h3 { font-size: 1.25em; }
    .content h4 { font-size: 1em; }
    .content p { margin: 1em 0; }
    .content a { color: var(--primary); text-decoration: none; }
    .content a:hover { text-decoration: underline; }
    .content ul, .content ol { margin: 1em 0; padding-left: 2em; }
    .content li { margin: 0.25em 0; }
    .content blockquote {
      margin: 1em 0;
      padding: 0.5em 1em;
      border-left: 4px solid var(--primary);
      background: var(--code-bg);
      color: var(--text-muted);
    }
    .content pre {
      margin: 1em 0;
      padding: 16px;
      background: var(--code-bg);
      border-radius: 8px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 13px;
      line-height: 1.5;
    }
    .content code {
      font-family: var(--font-mono);
      font-size: 0.9em;
      padding: 0.2em 0.4em;
      background: var(--code-bg);
      border-radius: 4px;
    }
    .content pre code {
      padding: 0;
      background: none;
    }
    .content img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
    }
    .content table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
    }
    .content th, .content td {
      padding: 8px 12px;
      border: 1px solid var(--border);
      text-align: left;
    }
    .content th {
      background: var(--code-bg);
      font-weight: 600;
    }
    .content hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 2em 0;
    }
    .content .task-list-item {
      list-style: none;
      margin-left: -1.5em;
    }
    .content .task-list-item input {
      margin-right: 0.5em;
    }
  `;

export function parseMarkdown(md: string): string {
  let html = md;

  // Remove frontmatter
  html = html.replace(/^---\n[\s\S]*?\n---\n?/, '');

  // Code blocks (before other processing)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers with anchors
  html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, text) => {
    const level = hashes.length;
    const anchor = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `<h${level} id="${anchor}">${escapeHtml(text)}</h${level}>`;
  });

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // Horizontal rules
  html = html.replace(/^(?:---|\*\*\*|___)$/gm, '<hr>');

  // Blockquotes
  html = html.replace(/^>\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // Task lists
  html = html.replace(/^(\s*)- \[x\] (.*)$/gm, '$1<li class="task-list-item"><input type="checkbox" checked disabled> $2</li>');
  html = html.replace(/^(\s*)- \[ \] (.*)$/gm, '$1<li class="task-list-item"><input type="checkbox" disabled> $2</li>');

  // Unordered lists
  html = html.replace(/^(\s*)[-*+]\s+(.*)$/gm, '$1<li>$2</li>');

  // Ordered lists
  html = html.replace(/^(\s*)\d+\.\s+(.*)$/gm, '$1<li>$2</li>');

  // Wrap consecutive list items
  html = html.replace(/(<li>[\s\S]*?<\/li>)(\n(?!<li>))/g, '<ul>$1</ul>$2');

  // Tables
  html = html.replace(/^\|(.+)\|\n\|[-:| ]+\|\n((?:\|.+\|\n?)+)/gm, (_, header, body) => {
    const headers = header.split('|').filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map((row: string) => {
      const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Paragraphs
  html = html.replace(/^(?!<[a-z]|$)(.+)$/gm, '<p>$1</p>');

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  // Clean up nested elements
  html = html.replace(/<p>(<(?:ul|ol|blockquote|pre|table|h[1-6]))/g, '$1');
  html = html.replace(/(<\/(?:ul|ol|blockquote|pre|table|h[1-6])>)<\/p>/g, '$1');

  return html;
}
