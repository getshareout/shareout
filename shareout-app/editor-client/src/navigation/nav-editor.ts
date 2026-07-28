// Inline Navigation editor for the Inspect panel. Reads/writes the link + transition attributes
// so a link's target/label/active-class and a page transition's type/duration can be changed
// without hand-editing attributes. Same shape as the Action/Field/Visibility editors.
import {
  LINK_ATTR,
  LINK_DISPLAY_ATTR,
  LINK_ACTIVE_CLASS_ATTR,
  TRANSITION_ATTR,
  TRANSITION_DURATION_ATTR,
  LINK_TARGET_TYPES,
  TRANSITION_TYPES,
  type LinkTargetType,
} from '../sdk-patterns';
import { escapeHtml } from '../utils';

export interface LinkState {
  targetType: LinkTargetType;
  targetId: string;
  display: string;
  activeClass: string;
}

export interface LinkEdit {
  targetType: string;
  targetId: string;
  display: string;
  activeClass: string;
}

export interface TransitionState {
  type: string;
  duration: string;
}

const LINK_TYPE_LABELS: Record<string, string> = {
  page: 'Page',
  section: 'Section',
  tab: 'Tab',
  external: 'External URL',
  modal: 'Modal',
  history: 'History',
};

const TRANSITION_LABELS: Record<string, string> = {
  none: 'None',
  fade: 'Fade',
  'slide-left': 'Slide left',
  'slide-right': 'Slide right',
  'slide-up': 'Slide up',
  'slide-down': 'Slide down',
  zoom: 'Zoom',
};

const TARGET_PLACEHOLDERS: Record<string, string> = {
  page: 'e.g. home',
  section: 'e.g. pricing',
  tab: 'e.g. details',
  external: 'https://…',
  modal: 'e.g. add-task',
  history: 'back or forward',
};

/** Split a link target into type + id (mirrors nav-detector's parseTarget). */
export function parseTarget(target: string): { targetType: LinkTargetType; targetId: string } {
  const parts = (target || '').split(':');
  if (parts.length < 2) return { targetType: 'page', targetId: target || '' };
  return { targetType: parts[0] as LinkTargetType, targetId: parts.slice(1).join(':') };
}

export function readLink(el: Element): LinkState {
  const { targetType, targetId } = parseTarget(el.getAttribute(LINK_ATTR) || '');
  return {
    targetType: targetType || 'page',
    targetId,
    display: el.getAttribute(LINK_DISPLAY_ATTR) || '',
    activeClass: el.getAttribute(LINK_ACTIVE_CLASS_ATTR) || '',
  };
}

export function applyLink(el: Element, next: LinkEdit): void {
  el.setAttribute(LINK_ATTR, `${next.targetType}:${next.targetId}`);
  if (next.display) el.setAttribute(LINK_DISPLAY_ATTR, next.display);
  else el.removeAttribute(LINK_DISPLAY_ATTR);
  if (next.activeClass) el.setAttribute(LINK_ACTIVE_CLASS_ATTR, next.activeClass);
  else el.removeAttribute(LINK_ACTIVE_CLASS_ATTR);
}

export function readTransition(el: Element): TransitionState {
  return {
    type: el.getAttribute(TRANSITION_ATTR) || 'none',
    duration: el.getAttribute(TRANSITION_DURATION_ATTR) || '',
  };
}

export function applyTransition(el: Element, type: string, duration: string): void {
  el.setAttribute(TRANSITION_ATTR, type);
  if (duration) el.setAttribute(TRANSITION_DURATION_ATTR, duration);
  else el.removeAttribute(TRANSITION_DURATION_ATTR);
}

/** Page/section/tab ids in the document, for the link-target datalist. */
export function collectLinkTargetIds(doc: Document): string[] {
  const out = new Set<string>();
  ['data-shareout-page', 'data-shareout-section', 'data-shareout-tab'].forEach((attr) => {
    doc.querySelectorAll(`[${attr}]`).forEach((el) => {
      const v = el.getAttribute(attr);
      if (v) out.add(v);
    });
  });
  return [...out];
}

export function linkSectionMarkup(state: LinkState, targetIds: string[]): string {
  const typeOptions = LINK_TARGET_TYPES.map(
    (t) => `<option value="${t}"${t === state.targetType ? ' selected' : ''}>${LINK_TYPE_LABELS[t] || t}</option>`,
  ).join('');
  const datalist = targetIds.length
    ? `<datalist id="link-targets">${targetIds.map((t) => `<option value="${escapeHtml(t)}"></option>`).join('')}</datalist>`
    : '';
  return `
    <div class="property-group">
      <div class="property-group-title">Link</div>
      <div class="control-row control-row-stack">
        <span class="control-label">Go to</span>
        <select class="property-input" data-link-type>${typeOptions}</select>
        <input class="property-input" data-link-target list="link-targets" placeholder="${escapeHtml(TARGET_PLACEHOLDERS[state.targetType] || '')}" value="${escapeHtml(state.targetId)}">
        ${datalist}
      </div>
      <div class="control-row control-row-stack">
        <span class="control-label">Label</span>
        <input class="property-input" data-link-display placeholder="Link text (optional)" value="${escapeHtml(state.display)}">
      </div>
      <div class="control-row control-row-stack">
        <span class="control-label">Active class</span>
        <input class="property-input" data-link-active placeholder="e.g. active" value="${escapeHtml(state.activeClass)}">
      </div>
    </div>`;
}

export function transitionSectionMarkup(state: TransitionState): string {
  const typeOptions = TRANSITION_TYPES.map(
    (t) => `<option value="${t}"${t === state.type ? ' selected' : ''}>${TRANSITION_LABELS[t] || t}</option>`,
  ).join('');
  return `
    <div class="property-group">
      <div class="property-group-title">Transition</div>
      <div class="control-row control-row-stack">
        <span class="control-label">Animation</span>
        <select class="property-input" data-transition-type>${typeOptions}</select>
      </div>
      <div class="control-row">
        <span class="control-label">Duration</span>
        <input class="property-input" data-transition-duration type="number" min="0" step="50" placeholder="ms" value="${escapeHtml(state.duration)}">
      </div>
    </div>`;
}
