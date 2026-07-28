// Inline Field editor for the Inspect panel. Reads/writes the data-shareout-field* attributes
// plus the field's validation and options so a form field's label, required flag, validation,
// and choice source can be changed without hand-editing attributes. Same shape as the Action
// and Visibility editors.
//
// Label + required live on the field element; validation + options resolve to the child input
// (input || field) — exactly where form-detector reads them, so edits round-trip.
import {
  FIELD_ATTR,
  FIELD_LABEL_ATTR,
  FIELD_REQUIRED_ATTR,
  VALIDATION_ATTR,
  OPTIONS_ATTR,
  OPTIONS_SOURCE_ATTR,
  OPTIONS_VALUE_ATTR,
  OPTIONS_LABEL_ATTR,
} from '../sdk-patterns';
import { escapeHtml } from '../utils';

export type OptionsMode = 'none' | 'static' | 'source';

export interface FieldState {
  fieldId: string;
  label: string;
  required: boolean;
  validation: string;
  supportsOptions: boolean;
  optionsMode: OptionsMode;
  optionsStatic: string; // raw JSON from data-shareout-options
  optionsStaticError: boolean;
  optionsSource: string;
  optionsValueKey: string;
  optionsLabelKey: string;
}

export interface OptionsEdit {
  mode: OptionsMode;
  staticJson: string;
  source: string;
  valueKey: string;
  labelKey: string;
}

const OPTIONS_MODE_LABELS: Record<OptionsMode, string> = {
  none: 'No choices',
  static: 'Fixed list',
  source: 'From data',
};

/** The element carrying validation/options for a field — the child input if present, else the
 *  field element itself (mirrors form-detector's resolution). */
export function fieldInputEl(el: Element): Element {
  return el.querySelector('input, select, textarea') || el;
}

function elSupportsOptions(el: Element): boolean {
  const input = el.querySelector('input, select, textarea');
  if (input && input.tagName.toLowerCase() === 'select') return true;
  const be = fieldInputEl(el);
  return be.hasAttribute(OPTIONS_ATTR) || be.hasAttribute(OPTIONS_SOURCE_ATTR);
}

export function readField(el: Element): FieldState {
  const be = fieldInputEl(el);
  const optionsStatic = be.getAttribute(OPTIONS_ATTR) || '';
  const optionsSource = be.getAttribute(OPTIONS_SOURCE_ATTR) || '';
  let optionsStaticError = false;
  if (optionsStatic) {
    try {
      JSON.parse(optionsStatic);
    } catch {
      optionsStaticError = true;
    }
  }
  const optionsMode: OptionsMode = optionsSource ? 'source' : optionsStatic ? 'static' : 'none';
  return {
    fieldId: el.getAttribute(FIELD_ATTR) || '',
    label: el.getAttribute(FIELD_LABEL_ATTR) || '',
    required: el.getAttribute(FIELD_REQUIRED_ATTR) === 'true',
    validation: be.getAttribute(VALIDATION_ATTR) || '',
    supportsOptions: elSupportsOptions(el),
    optionsMode,
    optionsStatic,
    optionsStaticError,
    optionsSource,
    optionsValueKey: be.getAttribute(OPTIONS_VALUE_ATTR) || '',
    optionsLabelKey: be.getAttribute(OPTIONS_LABEL_ATTR) || '',
  };
}

export function setFieldLabel(el: Element, label: string): void {
  if (label) el.setAttribute(FIELD_LABEL_ATTR, label);
  else el.removeAttribute(FIELD_LABEL_ATTR);
}

export function setFieldRequired(el: Element, required: boolean): void {
  if (required) el.setAttribute(FIELD_REQUIRED_ATTR, 'true');
  else el.removeAttribute(FIELD_REQUIRED_ATTR);
}

export function setFieldValidation(el: Element, validation: string): void {
  const be = fieldInputEl(el);
  if (validation) be.setAttribute(VALIDATION_ATTR, validation);
  else be.removeAttribute(VALIDATION_ATTR);
}

/** Write the options attrs onto the field's input, one mode at a time (clears the others). */
export function applyOptions(el: Element, next: OptionsEdit): void {
  const be = fieldInputEl(el);
  [OPTIONS_ATTR, OPTIONS_SOURCE_ATTR, OPTIONS_VALUE_ATTR, OPTIONS_LABEL_ATTR].forEach((a) =>
    be.removeAttribute(a),
  );
  if (next.mode === 'static' && next.staticJson) {
    be.setAttribute(OPTIONS_ATTR, next.staticJson);
  } else if (next.mode === 'source' && next.source) {
    be.setAttribute(OPTIONS_SOURCE_ATTR, next.source);
    if (next.valueKey) be.setAttribute(OPTIONS_VALUE_ATTR, next.valueKey);
    if (next.labelKey) be.setAttribute(OPTIONS_LABEL_ATTR, next.labelKey);
  }
}

export function fieldSectionMarkup(state: FieldState, bindableKeys: string[]): string {
  const optionsBlock = state.supportsOptions ? optionsControls(state, bindableKeys) : '';
  return `
    <div class="property-group">
      <div class="property-group-title">Field</div>
      <div class="control-row control-row-stack">
        <span class="control-label">Label</span>
        <input class="property-input" data-field-label placeholder="Label shown to users" value="${escapeHtml(state.label)}">
      </div>
      <div class="control-row">
        <span class="control-label">Required</span>
        <input type="checkbox" data-field-required${state.required ? ' checked' : ''}>
      </div>
      <div class="control-row control-row-stack">
        <span class="control-label">Validation</span>
        <input class="property-input" data-field-validation placeholder="e.g. email, min:3, /regex/" value="${escapeHtml(state.validation)}">
      </div>
      ${optionsBlock}
    </div>`;
}

function optionsControls(state: FieldState, bindableKeys: string[]): string {
  const modeOptions = (['none', 'static', 'source'] as OptionsMode[])
    .map((m) => `<option value="${m}"${m === state.optionsMode ? ' selected' : ''}>${OPTIONS_MODE_LABELS[m]}</option>`)
    .join('');
  const sourceInOptions = bindableKeys.includes(state.optionsSource);
  const sourceRows =
    state.optionsMode === 'source'
      ? `
      <div class="control-row control-row-stack" data-field-options-source-row>
        <span class="control-label">From</span>
        <select class="property-input" data-field-options-source>
          <option value="">— pick data —</option>
          ${bindableKeys.map((k) => `<option value="${escapeHtml(k)}"${k === state.optionsSource ? ' selected' : ''}>${escapeHtml(k)}</option>`).join('')}
          ${state.optionsSource && !sourceInOptions ? `<option value="${escapeHtml(state.optionsSource)}" selected>${escapeHtml(state.optionsSource)}</option>` : ''}
        </select>
        <input class="property-input" data-field-options-value placeholder="value key (e.g. id)" value="${escapeHtml(state.optionsValueKey)}">
        <input class="property-input" data-field-options-label placeholder="label key (e.g. name)" value="${escapeHtml(state.optionsLabelKey)}">
      </div>`
      : '';
  const staticRows =
    state.optionsMode === 'static'
      ? `
      <div class="control-row control-row-stack" data-field-options-static-row>
        <span class="control-label">Options</span>
        <textarea class="property-input" data-field-options-static rows="3" placeholder='[{"value":"a","label":"A"}]'>${escapeHtml(state.optionsStatic)}</textarea>
        ${state.optionsStaticError ? `<p class="bound-note bound-note-warn">⚠ Options is not valid JSON; it is ignored at runtime.</p>` : ''}
      </div>`
      : '';
  return `
      <div class="control-row control-row-stack">
        <span class="control-label">Choices</span>
        <select class="property-input" data-field-options-mode>${modeOptions}</select>
      </div>
      ${sourceRows}${staticRows}`;
}
