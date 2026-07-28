import { describe, expect, it } from 'vitest';
import { DashboardEditor } from '../src/sidecars/dashboard-editor';
import { EditorCollab } from '../src/sidecars/editor-collab';
import { PresentationEditor } from '../src/sidecars/presentation-editor';
import { registerSidecars } from '../src/register-sidecars';

describe('EditorCollab', () => {
  it('tracks soft lock expiry', () => {
    const collab = new EditorCollab('art1', 'u1', 'User');
    collab.softLocks.set('#el', {
      selector: '#el',
      userId: 'other',
      userName: 'Other',
      lockedAt: Date.now(),
      expiresAt: Date.now() - 1,
    });
    expect(collab.canEdit('#el')).toBe(true);
  });
});

describe('PresentationEditor', () => {
  it('adds a slide from template', () => {
    const editor = new PresentationEditor({ slides: [{ id: '1', title: 'A', html: '' }] });
    editor.addSlide('title');
    expect(editor.slides).toHaveLength(2);
    expect(editor.slides[1].title).toBe('Title Slide');
  });
});

describe('DashboardEditor', () => {
  it('adds a widget with grid position', () => {
    const editor = new DashboardEditor({ widgets: [] });
    editor.addWidget('kpi');
    expect(editor.widgets).toHaveLength(1);
    expect(editor.widgets[0].config.type).toBe('kpi');
  });
});

describe('registerSidecars', () => {
  it('exposes classes and instances on window', () => {
    registerSidecars();
    expect(window.EditorCollab).toBe(EditorCollab);
    expect(window.presentationEditor).toBeInstanceOf(PresentationEditor);
    expect(window.dashboardEditor).toBeInstanceOf(DashboardEditor);
  });
});
