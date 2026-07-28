import { generateViewerShell, type ViewerContext } from './viewer-shell';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderCsvViewer(ctx: ViewerContext): string {
  const metadata = ctx.typeMetadata.csv;
  const { headers, rows } = parseCsv(ctx.content, metadata?.delimiter || ',');

  const statsHtml = metadata ? `
    <div class="stats">
      <span>${metadata.rowCount.toLocaleString()} rows</span>
      <span>${metadata.columns.length} columns</span>
      <span>Delimiter: ${metadata.delimiter === '\t' ? 'TAB' : metadata.delimiter === ',' ? 'Comma' : metadata.delimiter}</span>
    </div>
  ` : '';

  const headerCells = headers.map((h, i) => {
    const type = metadata?.columns[i]?.type || 'string';
    const typeIcon = type === 'number' ? '#' : type === 'date' ? '📅' : type === 'boolean' ? '✓' : 'Aa';
    return `<th data-col="${i}" onclick="sortBy(${i})">
      <span class="header-content">
        <span class="header-text">${escapeHtml(h)}</span>
        <span class="type-hint" title="${type}">${typeIcon}</span>
        <span class="sort-icon">↕</span>
      </span>
    </th>`;
  }).join('');

  const bodyRows = rows.slice(0, 1000).map((row, i) => {
    const cells = row.map((cell, j) => {
      const type = metadata?.columns[j]?.type || 'string';
      return `<td class="cell-${type}">${escapeHtml(cell)}</td>`;
    }).join('');
    return `<tr data-row="${i}">${cells}</tr>`;
  }).join('');

  const truncatedWarning = rows.length > 1000 ? `
    <div class="truncated-warning">
      Showing first 1,000 of ${rows.length.toLocaleString()} rows. Download the file to see all data.
    </div>
  ` : '';

  const bodyContent = `
    <div class="csv-viewer">
      ${statsHtml}
      <div class="toolbar">
        <input type="text" class="search-input" placeholder="Filter rows..." oninput="filterRows(this.value)">
      </div>
      <div class="table-wrapper">
        <table class="data-table" id="data-table">
          <thead>
            <tr>${headerCells}</tr>
          </thead>
          <tbody id="table-body">
            ${bodyRows}
          </tbody>
        </table>
      </div>
      ${truncatedWarning}
      <div class="row-count" id="row-count">${rows.length.toLocaleString()} rows</div>
    </div>
  `;

  const extraStyles = `
    .csv-viewer {
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
      gap: 12px;
      margin-bottom: 12px;
    }
    .search-input {
      flex: 1;
      max-width: 400px;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      font-size: 13px;
    }
    .search-input:focus {
      outline: none;
      border-color: var(--primary);
    }
    .table-wrapper {
      flex: 1;
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .data-table th {
      position: sticky;
      top: 0;
      background: var(--code-bg);
      padding: 10px 12px;
      text-align: left;
      font-weight: 600;
      border-bottom: 2px solid var(--border);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    .data-table th:hover {
      background: var(--border);
    }
    .header-content {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .header-text {
      flex: 1;
    }
    .type-hint {
      font-size: 10px;
      color: var(--text-muted);
      opacity: 0.7;
    }
    .sort-icon {
      font-size: 10px;
      color: var(--text-muted);
      opacity: 0.5;
    }
    th.sort-asc .sort-icon { opacity: 1; }
    th.sort-asc .sort-icon::after { content: '↑'; }
    th.sort-desc .sort-icon { opacity: 1; }
    th.sort-desc .sort-icon::after { content: '↓'; }
    th.sort-asc .sort-icon, th.sort-desc .sort-icon { content: ''; }
    .data-table td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .data-table tr:hover td {
      background: var(--code-bg);
    }
    .cell-number {
      font-family: var(--font-mono);
      text-align: right;
    }
    .cell-date {
      color: var(--text-muted);
    }
    .cell-boolean {
      text-align: center;
    }
    .truncated-warning {
      padding: 12px;
      background: var(--color-warning-light);
      border: 1px solid color-mix(in srgb, var(--color-warning) 45%, transparent);
      border-radius: 6px;
      color: color-mix(in srgb, var(--color-warning) 80%, var(--color-text));
      font-size: 13px;
      margin-top: 12px;
    }
    @media (prefers-color-scheme: dark) {
      .truncated-warning {
        background: color-mix(in srgb, var(--color-warning) 15%, var(--color-bg-elevated));
        border-color: color-mix(in srgb, var(--color-warning) 50%, transparent);
        color: color-mix(in srgb, var(--color-warning) 70%, white);
      }
    }
    .row-count {
      margin-top: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }
    tr.hidden { display: none; }
  `;

  const extraHead = `
  <script>
    let sortCol = -1;
    let sortDir = 'asc';
    const allRows = Array.from(document.querySelectorAll('#table-body tr'));

    function sortBy(col) {
      const tbody = document.getElementById('table-body');
      const rows = Array.from(tbody.querySelectorAll('tr'));

      document.querySelectorAll('th').forEach(th => th.classList.remove('sort-asc', 'sort-desc'));

      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = 'asc';
      }

      document.querySelector('th[data-col="' + col + '"]').classList.add('sort-' + sortDir);

      rows.sort((a, b) => {
        const aVal = a.cells[col].textContent || '';
        const bVal = b.cells[col].textContent || '';

        const aNum = parseFloat(aVal.replace(/[^0-9.-]/g, ''));
        const bNum = parseFloat(bVal.replace(/[^0-9.-]/g, ''));

        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
        }

        return sortDir === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      });

      rows.forEach(row => tbody.appendChild(row));
    }

    function filterRows(query) {
      const tbody = document.getElementById('table-body');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const q = query.toLowerCase();
      let visible = 0;

      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if (text.includes(q)) {
          row.classList.remove('hidden');
          visible++;
        } else {
          row.classList.add('hidden');
        }
      });

      document.getElementById('row-count').textContent = visible.toLocaleString() + ' of ${rows.length.toLocaleString()} rows';
    }
  </script>
  `;

  return generateViewerShell(ctx, bodyContent, extraHead, extraStyles);
}

function parseCsv(content: string, delimiter: string): { headers: string[]; rows: string[][] } {
  const lines = content.split('\n');
  const headers: string[] = [];
  const rows: string[][] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cells = parseRow(line, delimiter);

    if (i === 0) {
      headers.push(...cells);
    } else {
      rows.push(cells);
    }
  }

  return { headers, rows };
}

function parseRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}
