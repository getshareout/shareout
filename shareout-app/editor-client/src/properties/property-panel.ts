// @ts-nocheck
import type { EditorContext } from '../editor/context';
import { escapeHtml, rgbToHex } from '../utils';
import { renderSelectionHandles } from '../canvas/selection';
import { syncHtmlFromCanvas } from '../history/html-sync';
import { pushUndo } from '../history/undo-redo';
import { markDirty } from '../persistence/draft';
import { getAllBindableKeys, getDefaultValue, validateBindingAgainstManifest } from '../manifest/manifest-parser';
import { parseConditionExpr, composeConditionExpr, isUnaryOperator, CONDITION_OPERATORS } from '../conditionals/condition-expr';
import { readAction, applyAction, collectActionTargets, actionSectionMarkup } from '../actions/action-editor';
import { FORMAT_TYPES, FORMAT_DETAIL, readFormat, applyFormat } from '../bindings/format-editor';
import {
  readField,
  setFieldLabel,
  setFieldRequired,
  setFieldValidation,
  applyOptions,
  fieldSectionMarkup,
} from '../forms/field-editor';
import {
  readLink,
  applyLink,
  readTransition,
  applyTransition,
  collectLinkTargetIds,
  linkSectionMarkup,
  transitionSectionMarkup,
} from '../navigation/nav-editor';
import { detectAndRenderChartEditor } from '../charts/chart-editor';
import {
  readTemplate,
  setTemplateName,
  setTemplateSource,
  templateSectionMarkup,
} from '../templates/template-editor';
import {
  IF_ATTR,
  SHOW_ATTR,
  HIDE_ATTR,
  ACTION_ATTR,
  ACTIONS_ATTR,
  FIELD_ATTR,
  LINK_ATTR,
  TRANSITION_ATTR,
  TEMPLATE_ATTR,
} from '../sdk-patterns';

const LEGACY_BIND_ATTRS = ['data-key', 'data-json-key', 'data-field', 'data-sdk-value', 'data-bind'];
const VIS_ATTRS = [IF_ATTR, SHOW_ATTR, HIDE_ATTR];
const OPERATOR_LABELS: Record<string, string> = {
  '=': 'equals', '!=': 'not equals', '>': 'greater than', '<': 'less than',
  '>=': '≥', '<=': '≤', contains: 'contains', empty: 'is empty', '!empty': 'is not empty',
};

// Brand palette swatches (from the ShareOut design system) — never make the user type a hex.
const TEXT_SWATCHES = ['#1c1917', '#57534e', '#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#ffffff'];
const FILL_SWATCHES = ['transparent', '#ffffff', '#fafaf9', '#f5f5f4', '#eff6ff', '#2563eb', '#1c1917'];

function firstLen(value: string): number {
  const m = (value || '').match(/-?\d+(\.\d+)?/);
  return m ? Math.round(parseFloat(m[0])) : 0;
}

function swatchRow(prop: string, current: string, swatches: string[]): string {
  const cur = rgbToHex(current);
  const dots = swatches
    .map((c) => {
      const active = c !== 'transparent' && rgbToHex(c) === cur ? ' active' : '';
      const transparent = c === 'transparent' ? ' swatch-transparent' : '';
      return `<button type="button" class="swatch${active}${transparent}" data-swatch-prop="${prop}" data-swatch-val="${c}" title="${c}"></button>`;
    })
    .join('');
  return `
    <div class="swatch-row">
      ${dots}
      <label class="swatch swatch-custom" title="Custom color">
        <input type="color" value="${cur}" data-swatch-prop="${prop}">
      </label>
    </div>`;
}

/** Apply dynamic swatch fills after HTML injection (avoids inline button styles). */
export function paintSwatchBackgrounds(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>('.swatch[data-swatch-val]').forEach((btn) => {
    const c = btn.dataset.swatchVal;
    if (c && c !== 'transparent') btn.style.background = c;
  });
}

function stepper(prop: string, value: number): string {
  return `
    <div class="stepper" data-step-prop="${prop}">
      <button class="stepper-btn" data-step="-1">&minus;</button>
      <span class="stepper-val" data-step-readout="${prop}">${value}</span>
      <button class="stepper-btn" data-step="1">+</button>
    </div>`;
}

export function renderPropertyPanel(ctx: EditorContext, element) {
  if (!ctx.dom.propertyPanel) return;

  if (!element) {
    ctx.dom.propertyPanel.innerHTML = `
      <div class="rail-empty">
        <p class="rail-empty-title">Nothing selected</p>
        <p class="rail-empty-hint">Click an element on the page to edit it.</p>
      </div>`;
    return;
  }

  const view = element.ownerDocument?.defaultView || window;
  const styles = view.getComputedStyle(element);
  const tagName = element.tagName.toLowerCase();
  const fontSize = firstLen(styles.fontSize) || 16;
  const align = styles.textAlign === 'start' ? 'left' : styles.textAlign;

  // Data binding — v2 `data-shareout-binding`, falling back to legacy attrs for display.
  const manifest = ctx.state.manifest;
  const bindableKeys = manifest ? getAllBindableKeys(manifest) : [];
  const currentBinding =
    element.getAttribute('data-shareout-binding') ||
    LEGACY_BIND_ATTRS.map((a) => element.getAttribute(a)).find(Boolean) ||
    '';
  const bindingPreview = currentBinding && manifest ? getDefaultValue(currentBinding, manifest) : undefined;
  const bindingError = currentBinding && manifest ? validateBindingAgainstManifest(currentBinding, manifest) : null;
  const bindingInOptions = bindableKeys.includes(currentBinding);
  const dataBindingSection = `
    <div class="property-group">
      <div class="property-group-title">Data</div>
      <div class="control-row control-row-stack">
        <span class="control-label">Connect to</span>
        <select class="property-input" data-bind-select>
          <option value="">— not connected —</option>
          ${bindableKeys.map((k) => `<option value="${escapeHtml(k)}"${k === currentBinding ? ' selected' : ''}>${escapeHtml(k)}</option>`).join('')}
          ${currentBinding && !bindingInOptions ? `<option value="${escapeHtml(currentBinding)}" selected>${escapeHtml(currentBinding)}</option>` : ''}
        </select>
      </div>
      ${currentBinding ? `<div class="control-row">
        <span class="control-label">Value</span>
        <code class="bound-value">${escapeHtml(bindingPreview !== undefined ? String(bindingPreview) : '(resolved at runtime)')}</code>
      </div>` : ''}
      ${bindingError ? `<p class="bound-note bound-note-warn">⚠ ${escapeHtml(bindingError)}</p>` : ''}
      ${!bindableKeys.length ? `<p class="bound-note">Declare data in your manifest (or the Data tab) to connect it here.</p>` : ''}
    </div>`;

  // Format — number/currency/percent/date display for a bound value (data-shareout-format).
  const { type: formatType, detail: formatDetail } = readFormat(element);
  const formatSection = currentBinding ? `
    <div class="property-group">
      <div class="property-group-title">Format</div>
      <div class="control-row control-row-stack">
        <span class="control-label">Display as</span>
        <select class="property-input" data-format-type>
          ${FORMAT_TYPES.map(([v, l]) => `<option value="${v}"${v === formatType ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      ${FORMAT_DETAIL[formatType] ? `<div class="control-row control-row-stack">
        <span class="control-label">${FORMAT_DETAIL[formatType].label}</span>
        <input class="property-input" data-format-detail placeholder="${FORMAT_DETAIL[formatType].placeholder}" value="${escapeHtml(formatDetail)}">
      </div>` : ''}
    </div>` : '';

  // Visibility — conditional rendering (data-shareout-if / -show / -hide).
  const hideRaw = element.getAttribute(HIDE_ATTR);
  const ifRaw = element.getAttribute(IF_ATTR) ?? element.getAttribute(SHOW_ATTR);
  const visMode = hideRaw != null ? 'hide' : ifRaw != null ? 'show' : 'always';
  const visExpr = parseConditionExpr(hideRaw ?? ifRaw ?? '');
  const visOp = visExpr.operator || '=';
  const visBindingInOptions = bindableKeys.includes(visExpr.binding);
  const visibilitySection = `
    <div class="property-group">
      <div class="property-group-title">Visibility</div>
      <div class="control-row control-row-stack">
        <span class="control-label">Rule</span>
        <select class="property-input" data-vis-mode>
          <option value="always"${visMode === 'always' ? ' selected' : ''}>Always shown</option>
          <option value="show"${visMode === 'show' ? ' selected' : ''}>Show only when…</option>
          <option value="hide"${visMode === 'hide' ? ' selected' : ''}>Hide when…</option>
        </select>
      </div>
      <div class="control-row control-row-stack" data-vis-when${visMode === 'always' ? ' style="display:none"' : ''}>
        <span class="control-label">When</span>
        <select class="property-input" data-vis-binding>
          <option value="">— pick data —</option>
          ${bindableKeys.map((k) => `<option value="${escapeHtml(k)}"${k === visExpr.binding ? ' selected' : ''}>${escapeHtml(k)}</option>`).join('')}
          ${visExpr.binding && !visBindingInOptions ? `<option value="${escapeHtml(visExpr.binding)}" selected>${escapeHtml(visExpr.binding)}</option>` : ''}
        </select>
        <select class="property-input" data-vis-op>
          ${CONDITION_OPERATORS.map((op) => `<option value="${op}"${op === visOp ? ' selected' : ''}>${OPERATOR_LABELS[op] || op}</option>`).join('')}
        </select>
        <input class="property-input" data-vis-value placeholder="value" value="${escapeHtml(visExpr.value || '')}"${isUnaryOperator(visOp) ? ' style="display:none"' : ''}>
      </div>
    </div>`;

  // Action — single-action editor (data-shareout-action*), shown when the element carries one.
  const hasAction = element.hasAttribute(ACTION_ATTR) || element.hasAttribute(ACTIONS_ATTR);
  const actionSection = hasAction
    ? actionSectionMarkup(readAction(element), collectActionTargets(element.ownerDocument))
    : '';

  // Field — form-field editor (data-shareout-field*), shown when the element is a field.
  const hasField = element.hasAttribute(FIELD_ATTR);
  const fieldSection = hasField ? fieldSectionMarkup(readField(element), bindableKeys) : '';

  // Template — repeating-content editor (data-shareout-template*), shown for a template element.
  const hasTemplate = element.hasAttribute(TEMPLATE_ATTR);
  const templateSourceOptions = manifest
    ? [...(manifest.tableNames || []).map((t) => `table:${t}`), ...(manifest.jsonKeys || []).map((j) => `json:${j}`)]
    : [];
  const templateSection = hasTemplate
    ? templateSectionMarkup(readTemplate(element), templateSourceOptions)
    : '';

  // Link + Transition — navigation editors (data-shareout-link* / data-shareout-transition*).
  const hasLink = element.hasAttribute(LINK_ATTR);
  const linkSection = hasLink
    ? linkSectionMarkup(readLink(element), collectLinkTargetIds(element.ownerDocument))
    : '';
  const hasTransition = element.hasAttribute(TRANSITION_ATTR);
  const transitionSection = hasTransition ? transitionSectionMarkup(readTransition(element)) : '';

  const alignBtn = (val, label) =>
    `<button class="seg-btn${align === val ? ' active' : ''}" data-align="${val}" title="Align ${val}">${label}</button>`;

  ctx.dom.propertyPanel.innerHTML = `
    <div class="rail-suggestions" id="inspect-suggestions"></div>

    <div class="inspect-actions">
      <button class="inspect-action" data-act="move-up" title="Move up">↑</button>
      <button class="inspect-action" data-act="move-down" title="Move down">↓</button>
      <button class="inspect-action inspect-action-danger" data-act="delete" title="Delete">Delete</button>
    </div>

    ${dataBindingSection}

    ${formatSection}

    ${visibilitySection}

    ${actionSection}

    ${fieldSection}

    ${templateSection}

    ${linkSection}

    ${transitionSection}

    <div class="property-group">
      <div class="property-group-title">Text</div>
      <div class="control-row">
        <span class="control-label">Size</span>
        <input type="range" min="10" max="80" value="${fontSize}" class="control-slider" data-slider="fontSize">
        <span class="control-readout" data-readout="fontSize">${fontSize}px</span>
      </div>
      <div class="control-row">
        <span class="control-label">Align</span>
        <div class="seg">
          ${alignBtn('left', '⊣')}${alignBtn('center', '≡')}${alignBtn('right', '⊢')}
        </div>
      </div>
      <div class="control-row control-row-stack">
        <span class="control-label">Color</span>
        ${swatchRow('color', styles.color, TEXT_SWATCHES)}
      </div>
    </div>

    <div class="property-group">
      <div class="property-group-title">Spacing</div>
      <div class="control-row">
        <span class="control-label">Padding</span>
        ${stepper('padding', firstLen(styles.paddingTop))}
      </div>
      <div class="control-row">
        <span class="control-label">Margin</span>
        ${stepper('margin', firstLen(styles.marginTop))}
      </div>
    </div>

    <div class="property-group">
      <div class="property-group-title">Background</div>
      <div class="control-row control-row-stack">
        <span class="control-label">Fill</span>
        ${swatchRow('backgroundColor', styles.backgroundColor, FILL_SWATCHES)}
      </div>
    </div>

    <details class="property-advanced">
      <summary>Advanced</summary>
      <div class="property-group">
        <div class="control-row">
          <span class="control-label">Tag</span>
          <input class="property-input" value="${tagName}" readonly>
        </div>
        <div class="control-row">
          <span class="control-label">ID</span>
          <input class="property-input" value="${escapeHtml(element.id || '')}" data-attr="id">
        </div>
        <div class="control-row">
          <span class="control-label">Class</span>
          <input class="property-input" value="${escapeHtml(element.className || '')}" data-attr="class">
        </div>
        <div class="control-row">
          <span class="control-label">Width</span>
          <input class="property-input" value="${styles.width}" data-style="width">
        </div>
        <div class="control-row">
          <span class="control-label">Height</span>
          <input class="property-input" value="${styles.height}" data-style="height">
        </div>
      </div>
    </details>
  `;

  const commit = () => {
    markDirty(ctx);
    syncHtmlFromCanvas(ctx);
    renderSelectionHandles(element, ctx.dom);
  };

  // Element actions
  ctx.dom.propertyPanel.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'move-up' && element.previousElementSibling) {
        pushUndo(ctx.state);
        element.parentElement?.insertBefore(element, element.previousElementSibling);
      } else if (act === 'move-down' && element.nextElementSibling) {
        pushUndo(ctx.state);
        element.parentElement?.insertBefore(element.nextElementSibling, element);
      } else if (act === 'delete') {
        pushUndo(ctx.state);
        element.remove();
        ctx.state.selectedElement = null;
        renderSelectionHandles(null, ctx.dom);
        markDirty(ctx);
        syncHtmlFromCanvas(ctx);
        renderPropertyPanel(ctx, null);
        return;
      } else {
        return;
      }
      commit();
    });
  });

  // Font-size slider
  const slider = ctx.dom.propertyPanel.querySelector('[data-slider="fontSize"]');
  slider?.addEventListener('input', (e) => {
    const v = e.target.value;
    element.style.fontSize = `${v}px`;
    ctx.dom.propertyPanel.querySelector('[data-readout="fontSize"]').textContent = `${v}px`;
  });
  slider?.addEventListener('change', () => { pushUndo(ctx.state); commit(); });

  // Alignment segments
  ctx.dom.propertyPanel.querySelectorAll('[data-align]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pushUndo(ctx.state);
      element.style.textAlign = btn.dataset.align;
      ctx.dom.propertyPanel.querySelectorAll('[data-align]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      commit();
    });
  });

  // Color swatches (and custom picker)
  ctx.dom.propertyPanel.querySelectorAll('[data-swatch-val]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pushUndo(ctx.state);
      element.style[btn.dataset.swatchProp] = btn.dataset.swatchVal;
      const group = btn.closest('.swatch-row');
      group?.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
      btn.classList.add('active');
      commit();
    });
  });
  ctx.dom.propertyPanel.querySelectorAll('input[type="color"][data-swatch-prop]').forEach((input) => {
    input.addEventListener('input', (e) => {
      element.style[input.dataset.swatchProp] = e.target.value;
    });
    input.addEventListener('change', () => { pushUndo(ctx.state); commit(); });
  });

  // Spacing steppers
  ctx.dom.propertyPanel.querySelectorAll('.stepper').forEach((step) => {
    const prop = step.dataset.stepProp;
    const readout = step.querySelector('[data-step-readout]');
    step.querySelectorAll('[data-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        pushUndo(ctx.state);
        const dir = parseInt(btn.dataset.step, 10);
        const current = firstLen(view.getComputedStyle(element)[prop === 'padding' ? 'paddingTop' : 'marginTop']);
        const next = Math.max(0, current + dir * 4);
        element.style[prop] = `${next}px`;
        readout.textContent = String(next);
        commit();
      });
    });
  });

  // Advanced raw inputs
  ctx.dom.propertyPanel.querySelectorAll('[data-style]').forEach((input) => {
    input.addEventListener('change', (e) => {
      pushUndo(ctx.state);
      element.style[e.target.dataset.style] = e.target.value;
      commit();
    });
  });
  ctx.dom.propertyPanel.querySelectorAll('[data-attr]').forEach((input) => {
    input.addEventListener('change', (e) => {
      pushUndo(ctx.state);
      const attr = e.target.dataset.attr;
      if (attr === 'class') element.className = e.target.value;
      else element.setAttribute(attr, e.target.value);
      commit();
    });
  });

  // Data binding picker — write the v2 `data-shareout-binding` and migrate off any
  // legacy binding attrs so there is one source of truth.
  ctx.dom.propertyPanel.querySelector('[data-bind-select]')?.addEventListener('change', (e) => {
    pushUndo(ctx.state);
    const val = e.target.value;
    LEGACY_BIND_ATTRS.forEach((a) => element.removeAttribute(a));
    if (val) element.setAttribute('data-shareout-binding', val);
    else element.removeAttribute('data-shareout-binding');
    commit();
    renderPropertyPanel(ctx, element); // refresh value preview + validation
  });

  // Format editor — number/currency/percent/date display for the bound value. Changing the
  // type re-renders to show the matching detail input; the detail input commits on blur.
  const fmtPanel = ctx.dom.propertyPanel;
  const applyFormatEdit = (rerender: boolean) => {
    pushUndo(ctx.state);
    const type = fmtPanel.querySelector('[data-format-type]')?.value || '';
    const detail = fmtPanel.querySelector('[data-format-detail]')?.value || '';
    applyFormat(element, type, detail);
    commit();
    if (rerender) renderPropertyPanel(ctx, element);
  };
  fmtPanel.querySelector('[data-format-type]')?.addEventListener('change', () => applyFormatEdit(true));
  fmtPanel.querySelector('[data-format-detail]')?.addEventListener('change', () => applyFormatEdit(false));

  // Visibility editor — compose data-shareout-if / -hide from the builder. We toggle the
  // sub-rows via display (rather than re-rendering) so an in-progress edit doesn't reset.
  const visPanel = ctx.dom.propertyPanel;
  const applyVisibility = () => {
    pushUndo(ctx.state);
    const mode = visPanel.querySelector('[data-vis-mode]')?.value || 'always';
    VIS_ATTRS.forEach((a) => element.removeAttribute(a));
    if (mode !== 'always') {
      const binding = visPanel.querySelector('[data-vis-binding]')?.value || '';
      const op = visPanel.querySelector('[data-vis-op]')?.value || '=';
      const value = visPanel.querySelector('[data-vis-value]')?.value ?? '';
      if (binding) {
        element.setAttribute(mode === 'hide' ? HIDE_ATTR : IF_ATTR, composeConditionExpr({ binding, operator: op, value }));
      }
    }
    commit();
  };
  visPanel.querySelector('[data-vis-mode]')?.addEventListener('change', (e) => {
    const when = visPanel.querySelector('[data-vis-when]');
    if (when) when.style.display = e.target.value === 'always' ? 'none' : '';
    applyVisibility();
  });
  visPanel.querySelector('[data-vis-op]')?.addEventListener('change', (e) => {
    const valInput = visPanel.querySelector('[data-vis-value]');
    if (valInput) valInput.style.display = isUnaryOperator(e.target.value) ? 'none' : '';
    applyVisibility();
  });
  visPanel.querySelectorAll('[data-vis-binding], [data-vis-value]').forEach((el) => el.addEventListener('change', applyVisibility));

  // Action editor — write the data-shareout-action* attributes through undo/sync. Changing
  // the type re-renders (to show/hide Target+Confirm, or remove the section on "no action").
  const actPanel = ctx.dom.propertyPanel;
  const readActionEdit = () => ({
    type: actPanel.querySelector('[data-action-type]')?.value || '',
    trigger: actPanel.querySelector('[data-action-trigger]')?.value || '',
    target: actPanel.querySelector('[data-action-target]')?.value || '',
    confirm: actPanel.querySelector('[data-action-confirm]')?.value || '',
  });
  const applyActionEdit = (rerender) => {
    pushUndo(ctx.state);
    applyAction(element, readActionEdit());
    commit();
    if (rerender) renderPropertyPanel(ctx, element);
  };
  actPanel.querySelector('[data-action-type]')?.addEventListener('change', () => applyActionEdit(true));
  actPanel.querySelector('[data-action-trigger]')?.addEventListener('change', () => applyActionEdit(false));
  actPanel
    .querySelectorAll('[data-action-target], [data-action-confirm]')
    .forEach((el) => el.addEventListener('change', () => applyActionEdit(false)));

  // Field editor — label/required on the field, validation/options on its input. Changing the
  // options mode re-renders to swap the source/static rows.
  const fp = ctx.dom.propertyPanel;
  fp.querySelector('[data-field-label]')?.addEventListener('change', (e) => {
    pushUndo(ctx.state);
    setFieldLabel(element, e.target.value);
    commit();
  });
  fp.querySelector('[data-field-required]')?.addEventListener('change', (e) => {
    pushUndo(ctx.state);
    setFieldRequired(element, e.target.checked);
    commit();
  });
  fp.querySelector('[data-field-validation]')?.addEventListener('change', (e) => {
    pushUndo(ctx.state);
    setFieldValidation(element, e.target.value);
    commit();
  });
  const applyOptionsEdit = (rerender) => {
    pushUndo(ctx.state);
    applyOptions(element, {
      mode: fp.querySelector('[data-field-options-mode]')?.value || 'none',
      staticJson: fp.querySelector('[data-field-options-static]')?.value || '',
      source: fp.querySelector('[data-field-options-source]')?.value || '',
      valueKey: fp.querySelector('[data-field-options-value]')?.value || '',
      labelKey: fp.querySelector('[data-field-options-label]')?.value || '',
    });
    commit();
    if (rerender) renderPropertyPanel(ctx, element);
  };
  fp.querySelector('[data-field-options-mode]')?.addEventListener('change', () => applyOptionsEdit(true));
  fp
    .querySelectorAll('[data-field-options-source], [data-field-options-value], [data-field-options-label], [data-field-options-static]')
    .forEach((el) => el.addEventListener('change', () => applyOptionsEdit(false)));

  // Template editor — name + data source.
  fp.querySelector('[data-template-name]')?.addEventListener('change', (e) => {
    pushUndo(ctx.state);
    setTemplateName(element, e.target.value);
    commit();
  });
  fp.querySelector('[data-template-source]')?.addEventListener('change', (e) => {
    pushUndo(ctx.state);
    setTemplateSource(element, e.target.value);
    commit();
  });

  // Link editor — compose data-shareout-link from type + id; display/active-class optional.
  // Changing the type re-renders to refresh the target placeholder.
  const applyLinkEdit = (rerender) => {
    pushUndo(ctx.state);
    applyLink(element, {
      targetType: fp.querySelector('[data-link-type]')?.value || 'page',
      targetId: fp.querySelector('[data-link-target]')?.value || '',
      display: fp.querySelector('[data-link-display]')?.value || '',
      activeClass: fp.querySelector('[data-link-active]')?.value || '',
    });
    commit();
    if (rerender) renderPropertyPanel(ctx, element);
  };
  fp.querySelector('[data-link-type]')?.addEventListener('change', () => applyLinkEdit(true));
  fp
    .querySelectorAll('[data-link-target], [data-link-display], [data-link-active]')
    .forEach((el) => el.addEventListener('change', () => applyLinkEdit(false)));

  // Transition editor — data-shareout-transition + -duration.
  const applyTransitionEdit = () => {
    pushUndo(ctx.state);
    applyTransition(
      element,
      fp.querySelector('[data-transition-type]')?.value || 'none',
      fp.querySelector('[data-transition-duration]')?.value || '',
    );
    commit();
  };
  fp
    .querySelectorAll('[data-transition-type], [data-transition-duration]')
    .forEach((el) => el.addEventListener('change', applyTransitionEdit));

  paintSwatchBackgrounds(ctx.dom.propertyPanel);

  // Chart — append the inline chart editor when the element is a chart (self-gates on the attr).
  detectAndRenderChartEditor(ctx, element);
}
