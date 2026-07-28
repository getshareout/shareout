/**
 * Validation Panel - renders validation issues in the workspace drawer
 */

import type { EditorContext } from '../editor/context';
import { runValidation, type ValidationResult } from './validation-detector';
import { getIssueIcon, getCategoryIcon, type ValidationIssue, type IssueLevel } from './validation-rules';
import { escapeHtml } from '../utils';

let currentResult: ValidationResult | null = null;

export function renderValidationSection(ctx: EditorContext): string {
  const doc = ctx.dom.canvasFrame.contentDocument;
  if (!doc) {
    return '<p class="empty-hint">Canvas not loaded</p>';
  }

  currentResult = runValidation(doc);

  if (currentResult.issues.length === 0) {
    return renderSuccessState();
  }

  return renderValidationPanel(currentResult);
}

function renderSuccessState(): string {
  return `
    <div class="drawer-section validation-success">
      <div class="success-icon">✅</div>
      <p class="success-message">All checks passed</p>
      <p class="hint-subtext">No issues detected in your ShareOut markup</p>
    </div>
  `;
}

function renderValidationPanel(result: ValidationResult): string {
  const sections: string[] = [];

  const summary = renderSummary(result);

  if (result.errors.length > 0) {
    sections.push(renderIssueSection('Errors', 'error', result.errors));
  }

  if (result.warnings.length > 0) {
    sections.push(renderIssueSection('Warnings', 'warning', result.warnings));
  }

  if (result.infos.length > 0) {
    sections.push(renderIssueSection('Info', 'info', result.infos));
  }

  return `
    <div class="validation-panel" id="validation-panel">
      ${summary}
      ${sections.join('')}
    </div>
  `;
}

function renderSummary(result: ValidationResult): string {
  const parts: string[] = [];

  if (result.errors.length > 0) {
    parts.push(`<span class="summary-badge badge-error">${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}</span>`);
  }
  if (result.warnings.length > 0) {
    parts.push(`<span class="summary-badge badge-warning">${result.warnings.length} warning${result.warnings.length !== 1 ? 's' : ''}</span>`);
  }
  if (result.infos.length > 0) {
    parts.push(`<span class="summary-badge badge-info">${result.infos.length} info</span>`);
  }

  return `
    <div class="panel-summary validation-summary">
      ${parts.join('')}
    </div>
  `;
}

function renderIssueSection(title: string, level: IssueLevel, issues: ValidationIssue[]): string {
  return `
    <div class="drawer-section issue-section issue-section-${level}">
      <h3 class="drawer-section-title">
        <span>${getIssueIcon(level)} ${title}</span>
        <span class="section-count">${issues.length}</span>
      </h3>
      <div class="issue-list">
        ${issues.map((issue, idx) => renderIssueItem(issue, idx)).join('')}
      </div>
    </div>
  `;
}

function renderIssueItem(issue: ValidationIssue, idx: number): string {
  const categoryIcon = getCategoryIcon(issue.category);
  const hasElement = !!issue.element;

  return `
    <div class="issue-item issue-item-${issue.level}" data-issue-idx="${idx}" data-issue-id="${escapeHtml(issue.id)}" ${hasElement ? 'data-has-element="true"' : ''}>
      <div class="issue-header">
        <span class="issue-category-icon" title="${issue.category}">${categoryIcon}</span>
        <span class="issue-message">${escapeHtml(issue.message)}</span>
      </div>
      ${issue.suggestion ? `
        <div class="issue-suggestion">
          <span class="suggestion-label">Fix:</span>
          <span class="suggestion-text">${escapeHtml(issue.suggestion)}</span>
        </div>
      ` : ''}
      ${hasElement ? `
        <button class="issue-locate-btn" title="Locate in document">📍 Locate</button>
      ` : ''}
    </div>
  `;
}


export function setupValidationHandlers(ctx: EditorContext): void {
  // Bind to the freshly-rendered panel root, not ctx.dom.drawerContent — the rail renders the
  // panel into its own host, so the old binding meant Locate never fired in the rail (F4).
  // renderValidationSection recreates #validation-panel each render, so there is no stacking.
  const root = document.getElementById('validation-panel');
  if (!root || !currentResult) return;

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const locateBtn = target.closest('.issue-locate-btn');
    const issueItem = target.closest('[data-issue-id]') as HTMLElement | null;

    if (locateBtn && issueItem) {
      const issue = currentResult?.issues.find((i) => i.id === issueItem.dataset.issueId);
      if (issue?.element) {
        navigateToElement(ctx, issue.element);
      }
    }
  });
}

function navigateToElement(ctx: EditorContext, element: Element): void {
  const doc = ctx.dom.canvasFrame.contentDocument;
  if (!doc?.body.contains(element)) return;

  if (typeof ctx.selectElement === 'function') {
    ctx.selectElement(element);
  }

  try {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    // Scroll failed
  }

  const drawer = ctx.dom.workspaceDrawer;
  if (drawer) {
    setTimeout(() => {
      drawer.hidden = true;
    }, 150);
  }
}
