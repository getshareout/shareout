// Single source of truth for the save-status indicator's text + class (EDIT-09 F4).
// The class set by the code must match a CSS rule, or distinct states render identically.
// Previously "saved" used a `.saved` class with no rule (looked like "unsaved") and failures
// set bare `save-status` instead of `.error` — so saved / unsaved / failed could all look the
// same. This maps each state to a class that exists in topbar.css.ts.
export type SaveState = 'unsaved' | 'saving' | 'saved' | 'failed';

export function saveStatusView(state: SaveState): { text: string; className: string } {
  switch (state) {
    case 'saving':
      return { text: 'Saving…', className: 'save-status saving' };
    case 'saved':
      return { text: 'Saved', className: 'save-status saved' };
    case 'failed':
      return { text: 'Save failed', className: 'save-status error' };
    case 'unsaved':
    default:
      return { text: 'Unsaved', className: 'save-status' };
  }
}
