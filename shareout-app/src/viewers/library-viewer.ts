import { generateViewerShell, type ViewerContext } from './viewer-shell';
import { parseMarkdown, MARKDOWN_VIEWER_STYLES } from './markdown-viewer';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Library viewer: the README plus a module-install panel — version chips, exported
// symbols, and copy-paste import snippets (plain <script>, ESM, and so.lib).
export function renderLibraryViewer(ctx: ViewerContext): string {
  const meta = ctx.typeMetadata.library;
  const m = ctx.libraryMetrics;
  const html = parseMarkdown(ctx.content);

  const exportsList = meta?.exports ?? [];
  const importPath = m?.importPath ?? '';
  const absUrl = importPath ? `${ctx.baseUrl}${importPath}` : '';
  const named = exportsList.length ? `{ ${exportsList.join(', ')} }` : '* as mod';

  const chips = [
    m?.version ? `<span class="lib-chip lib-ver">v${escapeHtml(m.version)}</span>` : '',
    m?.scope ? `<span class="lib-chip">${m.scope === 'personal' ? 'personal' : 'workspace'}</span>` : '',
    ...exportsList.map(e => `<span class="lib-chip lib-export">${escapeHtml(e)}</span>`),
  ].join('');

  const snippets = importPath ? `
    <div class="lib-snippets">
      <div class="lib-snip">
        <div class="lib-snip-label">ESM import</div>
        <pre><code>import ${escapeHtml(named)} from "${escapeHtml(absUrl)}";</code></pre>
      </div>
      <div class="lib-snip">
        <div class="lib-snip-label">Script tag</div>
        <pre><code>&lt;script type="module"&gt;
  import ${escapeHtml(named)} from "${escapeHtml(absUrl)}";
&lt;/script&gt;</code></pre>
      </div>
      <div class="lib-snip">
        <div class="lib-snip-label">ShareOut SDK</div>
        <pre><code>const ${escapeHtml(named)} = await so.lib("${escapeHtml(m?.moduleName ?? '')}");</code></pre>
      </div>
    </div>` : '<p class="lib-empty">No published version yet.</p>';

  const allVersions = (m?.versions ?? []).length > 1
    ? `<div class="lib-versions">Versions: ${(m!.versions).map(v => `<code>${escapeHtml(v)}</code>`).join(' ')}</div>`
    : '';

  const bodyContent = `
    <div class="library-viewer">
      <div class="lib-head">
        <h1 class="lib-title">${escapeHtml(m?.moduleName || ctx.artifactName)}</h1>
        ${chips ? `<div class="lib-chips">${chips}</div>` : ''}
        ${snippets}
        ${allVersions}
      </div>
      <article class="content">${html}</article>
    </div>
  `;

  const extraStyles = `
    ${MARKDOWN_VIEWER_STYLES}
    .library-viewer { max-width: 860px; margin: 0 auto; }
    .lib-head {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 24px; margin-bottom: 20px;
    }
    .lib-title { font: 700 24px var(--font-display); margin: 0 0 12px; }
    .lib-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; }
    .lib-chip {
      font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: 999px;
      background: var(--code-bg); color: var(--text-muted);
    }
    .lib-chip.lib-ver { background: var(--primary); color: #fff; }
    .lib-chip.lib-export { background: transparent; border: 1px solid var(--border); font-family: var(--font-mono, monospace); }
    .lib-snippets { display: flex; flex-direction: column; gap: 12px; }
    .lib-snip-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); margin-bottom: 4px; }
    .lib-snip pre {
      margin: 0; background: var(--code-bg); border: 1px solid var(--border);
      border-radius: var(--radius-sm); padding: 12px 14px; overflow-x: auto;
      font: 13px var(--font-mono, monospace);
    }
    .lib-versions { margin-top: 14px; font-size: 13px; color: var(--text-muted); }
    .lib-versions code { background: var(--code-bg); padding: 2px 6px; border-radius: 4px; }
    .lib-empty { color: var(--text-muted); }
    .content { background: var(--surface); padding: 32px; border-radius: 12px; border: 1px solid var(--border); }
  `;

  return generateViewerShell(ctx, bodyContent, undefined, extraStyles);
}
