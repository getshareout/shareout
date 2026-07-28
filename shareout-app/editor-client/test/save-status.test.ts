import { describe, it, expect } from 'vitest';
import { saveStatusView, type SaveState } from '../src/persistence/save-status';

describe('saveStatusView (F4: classes must match CSS)', () => {
  it('maps each state to a distinct, CSS-backed class', () => {
    expect(saveStatusView('unsaved')).toEqual({ text: 'Unsaved', className: 'save-status' });
    expect(saveStatusView('saving')).toEqual({ text: 'Saving…', className: 'save-status saving' });
    expect(saveStatusView('saved')).toEqual({ text: 'Saved', className: 'save-status saved' });
    expect(saveStatusView('failed')).toEqual({ text: 'Save failed', className: 'save-status error' });
  });

  it('gives saved and failed visually distinct classes (the bug this fixes)', () => {
    const saved = saveStatusView('saved').className;
    const failed = saveStatusView('failed').className;
    const unsaved = saveStatusView('unsaved').className;
    expect(new Set([saved, failed, unsaved]).size).toBe(3); // all different
    expect(failed).toContain('error'); // failure uses the existing .error rule, not bare
  });
});
