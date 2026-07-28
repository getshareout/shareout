// Implicit validation surface — drives the topbar #btn-validation chip.
// Hidden while everything checks out; appears only when there's a real problem
// (errors or warnings). Clicking it still opens the full validation panel.
import type { EditorContext } from '../editor/context';
import { runValidation } from './validation-detector';

export function refreshValidityChip(ctx: EditorContext): void {
  const chip = document.getElementById('btn-validation');
  if (!chip) return;

  const doc = ctx.dom.canvasFrame?.contentDocument;
  if (!doc) return;

  const result = runValidation(doc);
  const errors = result.errors.length;
  const warnings = result.warnings.length;

  if (errors === 0 && warnings === 0) {
    chip.hidden = true;
    return;
  }

  const n = errors > 0 ? errors : warnings;
  const noun = errors > 0 ? 'issue' : 'warning';
  const label = `${n} ${noun}${n === 1 ? '' : 's'}`;

  chip.dataset.state = errors > 0 ? 'error' : 'warning';
  chip.hidden = false;
  chip.setAttribute('aria-label', `${label} — click to review`);

  const text = chip.querySelector('.validity-chip-text');
  if (text) text.textContent = label;
}
