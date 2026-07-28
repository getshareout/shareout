// Inline Action editor for the Inspect panel. Reads/writes the `data-shareout-action*`
// attributes (the SDK action contract) so a trigger, type, target, or confirmation can be
// changed without hand-editing attribute strings. Pairs with the Visibility editor
// (condition-expr.ts) and the Data binding picker — same render-markup + apply-on-change shape.
import {
  ACTION_ATTR,
  ACTION_TARGET_ATTR,
  ACTION_TRIGGER_ATTR,
  ACTION_CONFIRM_ATTR,
  ACTION_PARAMS_ATTR,
  ACTIONS_ATTR,
  ACTION_TYPES,
  ACTION_TRIGGERS,
  type ActionTrigger,
} from '../sdk-patterns';
import { escapeHtml } from '../utils';

export interface ActionState {
  type: string; // '' when the element has no single action (e.g. a pure chain)
  trigger: string; // resolved: explicit attr, else the element default
  target: string;
  confirm: string;
  isChain: boolean; // data-shareout-actions present
  paramsError: boolean; // data-shareout-action-params is present but not valid JSON
}

export interface ActionEdit {
  type: string;
  trigger: string;
  target: string;
  confirm: string;
}

const TYPE_LABELS: Record<string, string> = {
  navigate: 'Go to / navigate',
  open: 'Open (modal)',
  close: 'Close (modal)',
  submit: 'Submit form',
  insert: 'Insert row',
  update: 'Update row',
  delete: 'Delete row',
  toggle: 'Toggle value',
  set: 'Set value',
  call: 'Call function',
};

const TRIGGER_LABELS: Record<string, string> = {
  click: 'On click',
  submit: 'On submit',
  change: 'On change',
  blur: 'On blur',
  hover: 'On hover',
  load: 'On load',
};

/** Mirrors the detector's getDefaultTrigger so the select shows the trigger the runtime uses. */
export function defaultTriggerFor(el: Element): ActionTrigger {
  const tag = el.tagName.toLowerCase();
  if (tag === 'form') return 'submit';
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return 'change';
  return 'click';
}

export function readAction(el: Element): ActionState {
  const triggerAttr = el.getAttribute(ACTION_TRIGGER_ATTR) || '';
  const paramsRaw = el.getAttribute(ACTION_PARAMS_ATTR);
  let paramsError = false;
  if (paramsRaw) {
    try {
      JSON.parse(paramsRaw);
    } catch {
      paramsError = true;
    }
  }
  return {
    type: el.getAttribute(ACTION_ATTR) || '',
    trigger: triggerAttr || defaultTriggerFor(el),
    target: el.getAttribute(ACTION_TARGET_ATTR) || '',
    confirm: el.getAttribute(ACTION_CONFIRM_ATTR) || '',
    isChain: el.hasAttribute(ACTIONS_ATTR),
    paramsError,
  };
}

/** Write the single-action attributes. Empty type clears the action. A trigger equal to the
 *  element default is left implicit so the DOM stays clean (matches the detector's fallback). */
export function applyAction(el: Element, next: ActionEdit): void {
  if (!next.type) {
    clearAction(el);
    return;
  }
  el.setAttribute(ACTION_ATTR, next.type);
  if (next.trigger && next.trigger !== defaultTriggerFor(el)) {
    el.setAttribute(ACTION_TRIGGER_ATTR, next.trigger);
  } else {
    el.removeAttribute(ACTION_TRIGGER_ATTR);
  }
  if (next.target) el.setAttribute(ACTION_TARGET_ATTR, next.target);
  else el.removeAttribute(ACTION_TARGET_ATTR);
  if (next.confirm) el.setAttribute(ACTION_CONFIRM_ATTR, next.confirm);
  else el.removeAttribute(ACTION_CONFIRM_ATTR);
}

export function clearAction(el: Element): void {
  [ACTION_ATTR, ACTION_TARGET_ATTR, ACTION_TRIGGER_ATTR, ACTION_CONFIRM_ATTR].forEach((a) =>
    el.removeAttribute(a),
  );
}

/** Navigable targets present in the document, for the target datalist. Suggestions only —
 *  free text (e.g. `fn:exportPdf`, `table:tasks`) is still allowed. */
export function collectActionTargets(doc: Document): string[] {
  const out = new Set<string>();
  doc.querySelectorAll('[data-shareout-page]').forEach((el) => {
    const v = el.getAttribute('data-shareout-page');
    if (v) out.add(`page:${v}`);
  });
  doc.querySelectorAll('[data-shareout-section]').forEach((el) => {
    const v = el.getAttribute('data-shareout-section');
    if (v) out.add(`section:${v}`);
  });
  doc.querySelectorAll('[data-shareout-modal]').forEach((el) => {
    const v = el.getAttribute('data-shareout-modal');
    if (v) out.add(`modal:${v}`);
  });
  out.add('history:back');
  return [...out];
}

export function actionSectionMarkup(state: ActionState, targets: string[]): string {
  const body =
    state.isChain && !state.type
      ? chainNote()
      : singleActionControls(state, targets) + (state.isChain ? chainNote() : '');
  return `
    <div class="property-group">
      <div class="property-group-title">Action</div>
      ${body}
    </div>`;
}

function singleActionControls(state: ActionState, targets: string[]): string {
  const typeOptions = ['', ...ACTION_TYPES]
    .map(
      (t) =>
        `<option value="${t}"${t === state.type ? ' selected' : ''}>${t ? TYPE_LABELS[t] || t : '— no action —'}</option>`,
    )
    .join('');
  const triggerOptions = ACTION_TRIGGERS.map(
    (t) => `<option value="${t}"${t === state.trigger ? ' selected' : ''}>${TRIGGER_LABELS[t] || t}</option>`,
  ).join('');
  const datalist = targets.length
    ? `<datalist id="action-targets">${targets.map((t) => `<option value="${escapeHtml(t)}"></option>`).join('')}</datalist>`
    : '';
  const hidden = state.type ? '' : ' style="display:none"';
  return `
      <div class="control-row control-row-stack">
        <span class="control-label">When</span>
        <select class="property-input" data-action-trigger>${triggerOptions}</select>
      </div>
      <div class="control-row control-row-stack">
        <span class="control-label">Do</span>
        <select class="property-input" data-action-type>${typeOptions}</select>
      </div>
      <div class="control-row control-row-stack" data-action-target-row${hidden}>
        <span class="control-label">Target</span>
        <input class="property-input" data-action-target list="action-targets" placeholder="e.g. page:home, modal:add, fn:save" value="${escapeHtml(state.target)}">
        ${datalist}
      </div>
      <div class="control-row control-row-stack" data-action-confirm-row${hidden}>
        <span class="control-label">Confirm</span>
        <input class="property-input" data-action-confirm placeholder="Ask before running (optional)" value="${escapeHtml(state.confirm)}">
      </div>
      ${state.paramsError ? `<p class="bound-note bound-note-warn">⚠ Action params is not valid JSON; it is ignored at runtime.</p>` : ''}`;
}

function chainNote(): string {
  return `<p class="bound-note">Runs a multi-step action chain (<code>data-shareout-actions</code>). Edit chains in code or with the assistant.</p>`;
}
