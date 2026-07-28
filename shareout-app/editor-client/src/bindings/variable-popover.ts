/**
 * Variable Info Popover
 *
 * Shows detailed information about data-bound elements in the editor.
 * When clicking a bound variable, displays its source and binding type.
 */

import { parseBinding, describeBinding, getBindingSources, getElementBinding } from './parser';
import { escapeHtml } from '../utils';
import { BINDING_ATTR, BINDING_DISPLAY_ATTR } from '../sdk-patterns';

export interface VariablePopoverOptions {
  parentDocument: Document;
  onClose?: () => void;
}

const LEGACY_BINDING_ATTRS = [
  'data-key',
  'data-json-key',
  'data-field',
  'data-sdk-value',
  'data-bind',
];

export function isDataBoundElement(element: Element): boolean {
  if (element.hasAttribute(BINDING_ATTR)) {
    return true;
  }

  if (LEGACY_BINDING_ATTRS.some(attr => element.hasAttribute(attr))) {
    return true;
  }

  if (element.classList.contains('summary-value')) {
    const parent = element.parentElement;
    if (parent) {
      if (parent.hasAttribute(BINDING_ATTR)) return true;
      if (LEGACY_BINDING_ATTRS.some(attr => parent.hasAttribute(attr))) return true;
    }
  }

  const childWithBinding = element.querySelector(
    `[${BINDING_ATTR}], [data-key], [data-json-key], [data-field], [data-sdk-value], [data-bind]`
  );
  if (childWithBinding) {
    return true;
  }

  return false;
}

export function getBindingDescription(element: Element): {
  description: string;
  sources: { type: string; name: string }[];
  display: string | null;
  raw: string;
  bindingType: string;
} | null {
  const bindingInfo = getElementBinding(element);
  if (bindingInfo) {
    return {
      description: describeBinding(bindingInfo.parsed),
      sources: getBindingSources(bindingInfo.parsed),
      display: bindingInfo.display,
      raw: bindingInfo.binding,
      bindingType: bindingInfo.parsed.type,
    };
  }

  for (const attr of LEGACY_BINDING_ATTRS) {
    const value = element.getAttribute(attr);
    if (value) {
      return {
        description: `Legacy binding: ${attr}`,
        sources: [{ type: 'legacy', name: value }],
        display: element.getAttribute(BINDING_DISPLAY_ATTR) || value,
        raw: `${attr}="${value}"`,
        bindingType: 'legacy',
      };
    }
  }

  if (element.classList.contains('summary-value')) {
    const parent = element.parentElement;
    if (parent) {
      return getBindingDescription(parent);
    }
  }

  return null;
}

let currentPopover: HTMLDivElement | null = null;

export function showVariablePopover(
  element: Element,
  frameRect: DOMRect,
  options: VariablePopoverOptions
): void {
  hideVariablePopover();

  const bindingDesc = getBindingDescription(element);
  if (!bindingDesc) return;

  const rect = element.getBoundingClientRect();
  const popover = options.parentDocument.createElement('div');
  popover.id = 'variable-info-popover';
  popover.className = 'variable-popover';

  const typeIcon = getTypeIcon(bindingDesc.bindingType);

  const isTable = bindingDesc.bindingType === 'table';
  const isComputed = bindingDesc.bindingType === 'computed';
  const tableName = bindingDesc.sources.find(s => s.type === 'table')?.name;

  popover.innerHTML = `
    <div class="variable-popover-header">
      <div class="variable-popover-type" data-type="${escapeHtml(bindingDesc.bindingType)}">
        <span class="variable-type-icon">${typeIcon}</span>
        <span class="variable-type-label">${bindingDesc.bindingType.toUpperCase()}</span>
      </div>
      <button type="button" class="variable-popover-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>

    <div class="variable-popover-content">
      <div class="variable-popover-warning">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 9v4M12 17h.01"/>
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        </svg>
        <span class="variable-popover-warning-text">
          This value cannot be edited directly
        </span>
      </div>

      <div class="variable-popover-label variable-popover-lead">
        ${isTable ? 'This value comes from a table:' : isComputed ? 'This is a calculated value:' : 'This value is bound to data:'}
      </div>
      <div class="variable-popover-description">${bindingDesc.description}</div>

      ${bindingDesc.sources.length > 0 ? `
        <div class="variable-popover-sources">
          <div class="variable-popover-label variable-popover-sources-label">Data Source</div>
          ${bindingDesc.sources.map(s => `
            <div class="variable-source-chip" data-source-type="${escapeHtml(s.type)}">
              <span class="source-icon">${getSourceIcon(s.type)}</span>
              <div>
                <div class="source-name">${escapeHtml(s.name)}</div>
                <div class="source-type">${s.type === 'table' ? 'Table data' : s.type === 'json' ? 'JSON data' : escapeHtml(s.type)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <details class="variable-popover-details">
        <summary>Technical details</summary>
        <div class="variable-popover-raw">
          <code>${escapeHtml(bindingDesc.raw)}</code>
        </div>
      </details>
    </div>

    <div class="variable-popover-footer">
      ${isTable && tableName ? `
        <button type="button" class="so-c-btn so-c-btn--primary variable-popover-action" data-action="open-table" data-table="${escapeHtml(tableName)}">
          <span class="variable-popover-action-icon" aria-hidden="true">⊞</span>
          Open "${escapeHtml(tableName)}" Table
        </button>
      ` : `
        <span class="variable-popover-hint">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
          </svg>
          ${isComputed ? 'This formula updates automatically' : 'Edit the source data to change this value'}
        </span>
      `}
    </div>
  `;

  const popoverWidth = 320;
  const popoverHeight = 240;

  let left = frameRect.left + rect.left + (rect.width / 2) - (popoverWidth / 2);
  let top = frameRect.top + rect.bottom + 12;

  if (left < 12) left = 12;
  if (left + popoverWidth > window.innerWidth - 12) {
    left = window.innerWidth - popoverWidth - 12;
  }

  if (top + popoverHeight > window.innerHeight - 12) {
    top = frameRect.top + rect.top - popoverHeight - 12;
  }

  popover.style.cssText = `
    position: fixed;
    left: ${left}px;
    top: ${top}px;
    width: ${popoverWidth}px;
    z-index: 10001;
  `;

  options.parentDocument.body.appendChild(popover);
  currentPopover = popover;

  popover.querySelector('.variable-popover-close')?.addEventListener('click', () => {
    hideVariablePopover();
    options.onClose?.();
  });

  // Handle "Open Table" button click
  const openTableBtn = popover.querySelector('[data-action="open-table"]');
  if (openTableBtn) {
    openTableBtn.addEventListener('click', () => {
      const tableName = (openTableBtn as HTMLElement).dataset.table;
      if (tableName) {
        // Dispatch custom event that can be handled by the editor to open table editor
        const event = new CustomEvent('shareout:open-table', {
          detail: { tableName, element },
          bubbles: true,
        });
        options.parentDocument.dispatchEvent(event);
        hideVariablePopover();
        options.onClose?.();
      }
    });
  }

  const closeOnClickOutside = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node)) {
      hideVariablePopover();
      options.onClose?.();
      options.parentDocument.removeEventListener('click', closeOnClickOutside, true);
    }
  };

  setTimeout(() => {
    options.parentDocument.addEventListener('click', closeOnClickOutside, true);
  }, 0);
}

export function hideVariablePopover(): void {
  if (currentPopover) {
    currentPopover.remove();
    currentPopover = null;
  }
}

function getTypeIcon(type: string): string {
  switch (type) {
    case 'json': return '{ }';
    case 'table': return '⊞';
    case 'computed': return 'ƒx';
    case 'multi': return '∑';
    case 'legacy': return '🔗';
    default: return '📊';
  }
}

function getSourceIcon(type: string): string {
  switch (type) {
    case 'table': return '⊞';
    case 'json': return '{ }';
    default: return '📄';
  }
}

