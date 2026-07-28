import { generateViewerShell, type ViewerContext } from './viewer-shell';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderJsonViewer(ctx: ViewerContext): string {
  let parsed: unknown;
  let parseError = false;

  try {
    parsed = JSON.parse(ctx.content);
  } catch {
    parseError = true;
  }

  const metadata = ctx.typeMetadata.json;
  const statsHtml = metadata ? `
    <div class="stats">
      <span>Type: ${metadata.schema}</span>
      ${metadata.itemCount !== undefined ? `<span>${metadata.itemCount.toLocaleString()} items</span>` : ''}
      ${metadata.rootKeys?.length ? `<span>${metadata.rootKeys.length} keys</span>` : ''}
    </div>
  ` : '';

  let bodyContent: string;

  if (parseError) {
    bodyContent = `
      <div class="json-viewer">
        <div class="error">Invalid JSON content</div>
        <pre class="raw-content">${escapeHtml(ctx.content)}</pre>
      </div>
    `;
  } else {
    const treeHtml = renderJsonTree(parsed, '', 0);
    bodyContent = `
      <div class="json-viewer">
        ${statsHtml}
        <div class="toolbar">
          <button class="tool-btn" onclick="expandAll()">Expand All</button>
          <button class="tool-btn" onclick="collapseAll()">Collapse All</button>
          <button class="tool-btn" onclick="copyPath()">Copy Path</button>
        </div>
        <div class="content-wrapper">
          <div class="tree" id="json-tree">${treeHtml}</div>
        </div>
        <div class="path-display" id="path-display"></div>
      </div>
    `;
  }

  const extraStyles = `
    .json-viewer {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .stats {
      display: flex;
      gap: 16px;
      padding: 8px 16px;
      background: var(--code-bg);
      border-radius: 6px;
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    .tool-btn {
      padding: 6px 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 12px;
      color: var(--text);
      cursor: pointer;
      transition: all 0.15s;
    }
    .tool-btn:hover {
      background: var(--code-bg);
    }
    .error {
      padding: 12px;
      background: var(--color-error-light);
      border: 1px solid color-mix(in srgb, var(--color-error) 35%, transparent);
      border-radius: 6px;
      color: var(--color-error);
      margin-bottom: 12px;
    }
    @media (prefers-color-scheme: dark) {
      .error {
        background: color-mix(in srgb, var(--color-error) 18%, var(--color-bg-elevated));
        border-color: color-mix(in srgb, var(--color-error) 45%, transparent);
        color: color-mix(in srgb, var(--color-error) 65%, white);
      }
    }
    .content-wrapper {
      flex: 1;
      overflow: auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .raw-content {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .tree {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
      line-height: 1.6;
    }
    .node {
      margin-left: 20px;
    }
    .node-root { margin-left: 0; }
    .toggle {
      cursor: pointer;
      user-select: none;
      color: var(--text-muted);
      margin-right: 4px;
    }
    .toggle:hover { color: var(--primary); }
    .key {
      color: var(--color-primary);
    }
    @media (prefers-color-scheme: dark) {
      .key { color: color-mix(in srgb, var(--color-primary) 70%, white); }
    }
    .string { color: var(--color-success); }
    .number { color: var(--color-warning); }
    .boolean { color: var(--color-primary-hover); }
    .null { color: var(--color-text-tertiary); }
    @media (prefers-color-scheme: dark) {
      .string { color: color-mix(in srgb, var(--color-success) 75%, white); }
      .number { color: color-mix(in srgb, var(--color-warning) 75%, white); }
    }
    .bracket { color: var(--text-muted); }
    .collapsed > .children { display: none; }
    .collapsed > .toggle::before { content: '▶'; }
    .expanded > .toggle::before { content: '▼'; }
    .path-display {
      margin-top: 12px;
      padding: 8px 12px;
      background: var(--code-bg);
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      color: var(--text-muted);
      min-height: 32px;
    }
    .value:hover {
      background: var(--code-bg);
      border-radius: 2px;
      cursor: pointer;
    }
  `;

  const extraHead = `
  <script>
    let currentPath = '';
    function toggle(el) {
      el.parentElement.classList.toggle('collapsed');
      el.parentElement.classList.toggle('expanded');
    }
    function expandAll() {
      document.querySelectorAll('.node').forEach(n => {
        n.classList.remove('collapsed');
        n.classList.add('expanded');
      });
    }
    function collapseAll() {
      document.querySelectorAll('.node').forEach(n => {
        n.classList.add('collapsed');
        n.classList.remove('expanded');
      });
    }
    function showPath(path) {
      currentPath = path;
      document.getElementById('path-display').textContent = path || 'Click a value to see its path';
    }
    function copyPath() {
      if (currentPath) {
        navigator.clipboard.writeText(currentPath);
      }
    }
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('.node').forEach(n => n.classList.add('expanded'));
    });
  </script>
  `;

  return generateViewerShell(ctx, bodyContent, extraHead, extraStyles);
}

function renderJsonTree(value: unknown, path: string, depth: number): string {
  if (value === null) {
    return `<span class="value null" onclick="showPath('${path}')">null</span>`;
  }

  if (typeof value === 'boolean') {
    return `<span class="value boolean" onclick="showPath('${path}')">${value}</span>`;
  }

  if (typeof value === 'number') {
    return `<span class="value number" onclick="showPath('${path}')">${value}</span>`;
  }

  if (typeof value === 'string') {
    const escaped = escapeHtml(value).replace(/\n/g, '\\n');
    const display = escaped.length > 100 ? escaped.slice(0, 100) + '...' : escaped;
    return `<span class="value string" onclick="showPath('${path}')">"${display}"</span>`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `<span class="bracket" onclick="showPath('${path}')">[]</span>`;
    }

    const items = value.map((item, i) => {
      const itemPath = `${path}[${i}]`;
      return `<div class="item">${renderJsonTree(item, itemPath, depth + 1)},</div>`;
    }).join('');

    return `<div class="node ${depth === 0 ? 'node-root' : ''}">
      <span class="toggle" onclick="toggle(this)"></span>
      <span class="bracket">[</span>
      <span class="count">${value.length} items</span>
      <div class="children">${items}</div>
      <span class="bracket">]</span>
    </div>`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return `<span class="bracket" onclick="showPath('${path}')">{}</span>`;
    }

    const entries = keys.map(key => {
      const keyPath = path ? `${path}.${key}` : key;
      const val = (value as Record<string, unknown>)[key];
      return `<div class="entry"><span class="key">"${escapeHtml(key)}"</span>: ${renderJsonTree(val, keyPath, depth + 1)},</div>`;
    }).join('');

    return `<div class="node ${depth === 0 ? 'node-root' : ''}">
      <span class="toggle" onclick="toggle(this)"></span>
      <span class="bracket">{</span>
      <span class="count">${keys.length} keys</span>
      <div class="children">${entries}</div>
      <span class="bracket">}</span>
    </div>`;
  }

  return `<span class="value">${String(value)}</span>`;
}
