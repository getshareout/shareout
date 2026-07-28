import { generateViewerShell, type ViewerContext } from './viewer-shell';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderTxtViewer(ctx: ViewerContext): string {
  const lines = ctx.content.split('\n');
  const lineCount = lines.length;
  const maxLineWidth = String(lineCount).length;

  const linesHtml = lines.map((line, i) => {
    const lineNum = String(i + 1).padStart(maxLineWidth, ' ');
    return `<div class="line"><span class="line-num">${lineNum}</span><span class="line-content">${escapeHtml(line) || ' '}</span></div>`;
  }).join('');

  const metadata = ctx.typeMetadata.txt;
  const statsHtml = metadata ? `
    <div class="stats">
      <span>${lineCount.toLocaleString()} lines</span>
      <span>${metadata.charCount.toLocaleString()} characters</span>
    </div>
  ` : '';

  const bodyContent = `
    <div class="txt-viewer">
      ${statsHtml}
      <div class="content-wrapper">
        <pre class="content">${linesHtml}</pre>
      </div>
    </div>
  `;

  const extraStyles = `
    .txt-viewer {
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
      margin-bottom: 16px;
    }
    .content-wrapper {
      flex: 1;
      overflow: auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .content {
      margin: 0;
      padding: 16px;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
      line-height: 1.5;
      tab-size: 4;
      white-space: pre;
      overflow-x: auto;
    }
    .line {
      display: flex;
    }
    .line-num {
      color: var(--text-muted);
      padding-right: 16px;
      user-select: none;
      text-align: right;
      min-width: ${maxLineWidth + 2}ch;
      border-right: 1px solid var(--border);
      margin-right: 16px;
    }
    .line-content {
      flex: 1;
    }
    .line:hover {
      background: var(--code-bg);
    }
  `;

  return generateViewerShell(ctx, bodyContent, undefined, extraStyles);
}
