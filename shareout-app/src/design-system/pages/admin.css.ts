/**
 * ShareOut Design System - Admin Page Styles
 * Warm, confident, friendly - not clinical.
 * Use with baseStyles from shell.ts via renderHtmlPage().
 */

const adminComponents = `
/* Header - Substantial, warm */
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  height: 72px;
  padding: 0 var(--space-8);
  background: var(--color-bg-elevated);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 2px rgba(0,0,0,0.02);
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.header h1 {
  font: 700 22px var(--font-display);
  color: var(--color-text);
  letter-spacing: -0.01em;
}

/* Badges - Soft, readable */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 20px;
  font: 600 12px var(--font-body);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.badge-public {
  background: var(--color-success-light);
  color: var(--color-success);
}
.badge-private {
  background: var(--color-warning-light);
  color: var(--color-warning);
}

/* Container - Generous breathing room */
.container {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: var(--space-10) var(--space-8);
}

/* Grid Layout */
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-6);
}
@media (max-width: 768px) {
  .header { padding: 0 var(--space-5); height: 64px; }
  .header h1 { font-size: 18px; }
  .container { padding: var(--space-6) var(--space-5); }
  .grid { grid-template-columns: 1fr; }
}

/* Cards - Soft, approachable */
.card {
  background: var(--color-bg-elevated);
  border-radius: 20px;
  border: 1px solid var(--color-border);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--duration-normal) var(--ease-out),
              transform var(--duration-normal) var(--ease-out);
}
.card:hover {
  box-shadow: var(--shadow-md);
}
.card-header {
  margin-bottom: var(--space-5);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
.card-title {
  font: 600 17px var(--font-display);
  color: var(--color-text);
  letter-spacing: -0.01em;
}
.card-full { grid-column: 1 / -1; }

/* Stats - Prominent, warm */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
}
@media (max-width: 600px) {
  .stat-grid { grid-template-columns: 1fr; }
}
.stat {
  background: linear-gradient(135deg, var(--color-primary-light) 0%, var(--color-surface) 100%);
  border-radius: 16px;
  padding: var(--space-6) var(--space-5);
  text-align: center;
  border: 1px solid rgba(37, 99, 235, 0.08);
}
.stat-value {
  font: 700 32px var(--font-display);
  color: var(--color-primary);
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.stat-label {
  font: 500 13px var(--font-body);
  color: var(--color-text-secondary);
  margin-top: var(--space-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Chart - Visual, informative */
.chart {
  height: 160px;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-top: var(--space-6);
  padding: 0 var(--space-2);
}
.chart-bar {
  flex: 1;
  background: linear-gradient(180deg, var(--color-primary) 0%, #3b82f6 100%);
  border-radius: 8px 8px 4px 4px;
  min-height: 6px;
  position: relative;
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out),
              filter var(--duration-fast) var(--ease-out);
}
.chart-bar:hover {
  transform: scaleY(1.02) translateY(-2px);
  filter: brightness(1.1);
}
.chart-bar::after {
  content: attr(data-value);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  font: 600 12px var(--font-body);
  color: var(--color-text);
  background: var(--color-bg-elevated);
  padding: 6px 10px;
  border-radius: 8px;
  box-shadow: var(--shadow-md);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-normal);
}
.chart-bar:hover::after { opacity: 1; }
.chart-labels {
  display: flex;
  gap: 8px;
  margin-top: var(--space-4);
  padding: 0 var(--space-2);
}
.chart-label {
  flex: 1;
  text-align: center;
  font: 500 12px var(--font-body);
  color: var(--color-text-tertiary);
}

/* Version List - Clean, scannable */
.version-list { list-style: none; }
.version-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-4) var(--space-3);
  margin: 0 calc(-1 * var(--space-3));
  border-radius: var(--radius-lg);
  transition: background var(--duration-fast) var(--ease-out);
}
.version-item:hover {
  background: var(--color-surface);
}
.version-item + .version-item {
  border-top: 1px solid var(--color-border);
}
.version-info {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.version-number {
  font: 600 14px var(--font-mono);
  color: var(--color-text);
  background: var(--color-surface);
  padding: 4px 10px;
  border-radius: 6px;
}
.version-date {
  font: 400 14px var(--font-body);
  color: var(--color-text-tertiary);
}
.live-badge {
  background: var(--color-success);
  color: white;
  padding: 5px 12px;
  border-radius: 20px;
  font: 700 11px var(--font-body);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  box-shadow: 0 2px 6px rgba(22, 163, 74, 0.3);
}

/* Top Lists - Readable, organized */
.top-list { list-style: none; }
.top-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-4) var(--space-3);
  margin: 0 calc(-1 * var(--space-3));
  border-radius: var(--radius-lg);
  font: 400 15px var(--font-body);
  transition: background var(--duration-fast) var(--ease-out);
}
.top-item:hover {
  background: var(--color-surface);
}
.top-item + .top-item { border-top: 1px solid var(--color-border); }
.top-item-name {
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70%;
}
.top-item-count {
  font: 600 15px var(--font-mono);
  color: var(--color-text);
  background: var(--color-surface);
  padding: 4px 12px;
  border-radius: 20px;
  min-width: 48px;
  text-align: center;
}

/* Empty State - Friendly, helpful */
.empty {
  text-align: center;
  padding: var(--space-12) var(--space-6);
}
.empty::before {
  content: '';
  display: block;
  width: 64px;
  height: 64px;
  margin: 0 auto var(--space-5);
  background: var(--color-surface);
  border-radius: 50%;
  opacity: 0.7;
}
.empty-title {
  font: 600 17px var(--font-display);
  color: var(--color-text);
  margin-bottom: var(--space-2);
}
.empty-text {
  font: 400 15px var(--font-body);
  color: var(--color-text-secondary);
  max-width: 280px;
  margin: 0 auto;
  line-height: 1.5;
}

/* Viewer Table - Warm, scannable */
.viewer-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}
.viewer-table th {
  padding: var(--space-3) var(--space-4);
  text-align: left;
  font: 600 12px var(--font-body);
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 2px solid var(--color-border);
}
.viewer-table td {
  padding: var(--space-4);
  text-align: left;
  font: 400 14px var(--font-body);
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
}
.viewer-table tr:hover td {
  background: var(--color-surface);
}
.viewer-table tr:last-child td {
  border-bottom: none;
}
.status-viewed {
  color: var(--color-success);
  font-weight: 600;
}
.status-viewed::before {
  content: '✓ ';
}
.status-pending {
  color: var(--color-text-tertiary);
}
.status-pending::before {
  content: '○ ';
}
`;

export const adminPageStyles = adminComponents;
