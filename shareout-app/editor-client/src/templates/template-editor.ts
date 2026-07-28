// Inline Template editor for the Inspect panel. Makes the (previously orphaned) template
// subsystem reachable: edit a repeating template's name + data source without hand-editing
// attributes. Same shape as the Action/Field/Nav editors. Per-item add/remove is a follow-up —
// items are generated from the source data at render time, not authored one by one.
import { TEMPLATE_ATTR, TEMPLATE_SOURCE_ATTR, TEMPLATE_ITEM_ATTR } from '../sdk-patterns';
import { escapeHtml } from '../utils';

export interface TemplateState {
  name: string;
  source: string;
  itemCount: number;
  bindingCount: number;
}

export function readTemplate(el: Element): TemplateState {
  return {
    name: el.getAttribute(TEMPLATE_ATTR) || '',
    source: el.getAttribute(TEMPLATE_SOURCE_ATTR) || '',
    itemCount: el.querySelectorAll(`[${TEMPLATE_ITEM_ATTR}]`).length,
    bindingCount: el.querySelectorAll('[data-shareout-binding]').length,
  };
}

/** Keep the attribute present (an empty name still marks a template; the detector auto-names it). */
export function setTemplateName(el: Element, name: string): void {
  el.setAttribute(TEMPLATE_ATTR, name);
}

export function setTemplateSource(el: Element, source: string): void {
  if (source) el.setAttribute(TEMPLATE_SOURCE_ATTR, source);
  else el.removeAttribute(TEMPLATE_SOURCE_ATTR);
}

export function templateSectionMarkup(state: TemplateState, sourceOptions: string[]): string {
  const datalist = sourceOptions.length
    ? `<datalist id="template-sources">${sourceOptions.map((s) => `<option value="${escapeHtml(s)}"></option>`).join('')}</datalist>`
    : '';
  const items = `${state.itemCount} item${state.itemCount === 1 ? '' : 's'}`;
  const bindings = `${state.bindingCount} binding${state.bindingCount === 1 ? '' : 's'}`;
  return `
    <div class="property-group">
      <div class="property-group-title">Template</div>
      <div class="control-row control-row-stack">
        <span class="control-label">Name</span>
        <input class="property-input" data-template-name placeholder="Template name" value="${escapeHtml(state.name)}">
      </div>
      <div class="control-row control-row-stack">
        <span class="control-label">Data source</span>
        <input class="property-input" data-template-source list="template-sources" placeholder="e.g. table:tasks, json:items" value="${escapeHtml(state.source)}">
        ${datalist}
      </div>
      <div class="control-row">
        <span class="control-label">Repeats</span>
        <span class="control-readout">${items} · ${bindings}</span>
      </div>
    </div>`;
}
