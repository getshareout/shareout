import { generateViewerShell, scriptOpen, type ViewerContext } from './viewer-shell';
import { viewerCopy } from './copy';
import { headingAnchors } from '../serve/heading-anchors';

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
      <h3 class="toc-title">${viewerCopy(ctx.locale).contents}</h3>
      <ul class="toc-list">
        ${metadata.toc.map(item => `
          <li class="toc-item toc-level-${item.level}">
            <a href="#${item.anchor}">${escapeHtml(item.text)}</a>
          </li>
        `).join('')}
      </ul>
    </nav>
  ` : '';

  // Converted PDF: Text | Original tabs; Original shows the PDF itself (served inline, same site).
  const tabs = ctx.source?.pdfTabs;
  const c = viewerCopy(ctx.locale);
  const tabsHtml = tabs ? `
    <nav class="doc-tabs" aria-label="${c.docViews}">
      <a class="doc-tab${tabs.showOriginal ? '' : ' is-on'}" href="${escapeHtml(tabs.textHref)}"${tabs.showOriginal ? '' : ' aria-current="page"'}>${c.typeText}</a>
      <a class="doc-tab${tabs.showOriginal ? ' is-on' : ''}" href="${escapeHtml(tabs.originalHref)}"${tabs.showOriginal ? ' aria-current="page"' : ''}>${c.tabOriginal}</a>
    </nav>` : '';
  const originalSrc = ctx.source ? `/a/${ctx.slug}/${ctx.source.original.split('/').map(encodeURIComponent).join('/')}` : '';
  const main = tabs?.showOriginal
    ? `<iframe class="original-pdf" src="${escapeHtml(originalSrc)}" title="${escapeHtml(ctx.source!.original.split('/').pop()!)}"></iframe>`
    : `<div class="layout">
        ${tocHtml}
        <article class="content">
          ${html}
        </article>
      </div>`;

  // Knowledge citations open /a/slug/?section=<anchor>. The anchor is headingAnchors() of the heading text (the
  // corpus chunker's function, embedded here via toString as the page agent does), numbered across the page.
  const sectionScript = `${scriptOpen(ctx)}(function(){var s=new URLSearchParams(location.search).get('section');if(!s||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(s))return;var hs=document.querySelectorAll('.content h1,.content h2,.content h3,.content h4,.content h5,.content h6');var texts=[];for(var i=0;i<hs.length;i++)texts.push(hs[i].textContent||'');var an=(${headingAnchors.toString()})(texts);var t=document.getElementById(s);for(var j=0;!t&&j<hs.length;j++)if(an[j]===s)t=hs[j];if(!t)return;t.scrollIntoView({block:'start'});t.classList.add('sec-hit');})();</script>`;

  const bodyContent = `
    <div class="markdown-viewer">
      ${tabsHtml}
      ${main}
    </div>
    ${sectionScript}
  `;

  const extraStyles = MARKDOWN_VIEWER_STYLES;

  return generateViewerShell(ctx, bodyContent, undefined, extraStyles);
}

export const MARKDOWN_VIEWER_STYLES = `
    .markdown-viewer {
      height: 100%;
    }
    .sec-hit { background: color-mix(in srgb, var(--primary) 12%, transparent); border-radius: 6px; scroll-margin-top: 16px; }
    .doc-tabs { display: flex; gap: 4px; max-width: 1200px; margin: 0 auto 16px; border-bottom: 1px solid var(--border); }
    .doc-tab { padding: 8px 12px; font-size: 13px; color: var(--text-muted); text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .doc-tab:hover { color: var(--text); }
    .doc-tab.is-on { color: var(--text); font-weight: 600; border-bottom-color: var(--primary); }
    .original-pdf { display: block; width: 100%; max-width: 1200px; margin: 0 auto; height: calc(100vh - 160px); min-height: 480px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
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

const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto']);

function unescapeHtml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Allow http(s)/mailto and scheme-less (relative, /path, #anchor, ?query) URLs only.
// Browsers drop ASCII whitespace/control chars when parsing a scheme, so strip them first.
export function isSafeMarkdownUrl(escapedUrl: string): boolean {
  // eslint-disable-next-line no-control-regex
  const url = unescapeHtml(escapedUrl).replace(/[\x00-\x20\x7f]/g, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(url);
  return !scheme || SAFE_URL_SCHEMES.has(scheme[1]);
}

const LIST_ITEM = /^([ \t]*)([-*+]|\d+\.)[ \t]+(.*)$/;

// Each run of consecutive list lines becomes one <ul>/<ol>; deeper indentation nests
// inside the previous item, a marker-kind change at the same depth starts a new list.
function renderLists(html: string): string {
  const lines = html.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length;) {
    if (!LIST_ITEM.test(lines[i])) { out.push(lines[i++]); continue; }
    const stack: Array<{ indent: number; tag: 'ul' | 'ol' }> = [];
    let list = '';
    for (; i < lines.length && LIST_ITEM.test(lines[i]); i++) {
      const [, ws, marker, text] = LIST_ITEM.exec(lines[i])!;
      const indent = ws.replace(/\t/g, '    ').length;
      const tag = marker.endsWith('.') ? 'ol' : 'ul';
      while (stack.length && indent < stack[stack.length - 1].indent) list += `</li></${stack.pop()!.tag}>`;
      const top = stack[stack.length - 1];
      if (top && indent === top.indent && top.tag !== tag) { list += `</li></${stack.pop()!.tag}>`; }
      const cur = stack[stack.length - 1];
      if (cur && indent <= cur.indent) list += '</li>';
      else {
        const start = tag === 'ol' ? parseInt(marker, 10) : 1;
        list += `<${tag}${start !== 1 ? ` start="${start}"` : ''}>`;
        stack.push({ indent, tag });
      }
      const task = tag === 'ul' ? /^\[([ xX])\] (.*)$/.exec(text) : null;
      list += task
        ? `<li class="task-list-item"><input type="checkbox"${task[1] === ' ' ? '' : ' checked'} disabled> ${task[2]}`
        : `<li>${text}`;
    }
    while (stack.length) list += `</li></${stack.pop()!.tag}>`;
    out.push(list);
  }
  return out.join('\n');
}

export function parseMarkdown(md: string): string {
  // eslint-disable-next-line no-control-regex
  let html = md.replace(/\u0000/g, '');

  // Remove frontmatter
  html = html.replace(/^---\n[\s\S]*?\n---\n?/, '');

  // Code blocks (before other processing) — stashed so inline formatting can't touch them
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push(`<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`);
    return `\u0000${codeBlocks.length - 1}\u0000`;
  });

  // Everything else is text: escape it before any markdown is turned into tags
  html = escapeHtml(html);

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers with anchors
  // Headers with anchors
  html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, text) => {
    const level = hashes.length;
    const anchor = unescapeHtml(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `<h${level} id="${anchor}">${text}</h${level}>`;
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

  // Images (before links, so ![alt](src) isn't consumed as a link)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) =>
    isSafeMarkdownUrl(src) ? `<img src="${src}" alt="${alt}">` : alt);

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) =>
    isSafeMarkdownUrl(href) ? `<a href="${href}">${text}</a>` : text);

  // Horizontal rules
  html = html.replace(/^(?:---|\*\*\*|___)$/gm, '<hr>');

  // Blockquotes
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // Lists (unordered, ordered, task, nested by indentation)
  html = renderLists(html);

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

  // eslint-disable-next-line no-control-regex
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => codeBlocks[Number(i)]);

  // Clean up nested elements
  html = html.replace(/<p>(<(?:ul|ol|blockquote|pre|table|h[1-6]))/g, '$1');
  html = html.replace(/(<\/(?:ul|ol|blockquote|pre|table|h[1-6])>)<\/p>/g, '$1');

  return html;
}
