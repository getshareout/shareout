import { DashboardEditor } from './sidecars/dashboard-editor';
import { EditorCollab } from './sidecars/editor-collab';
import { PresentationEditor } from './sidecars/presentation-editor';

/** Expose editor sidecar classes and default instances on `window`. */
export function registerSidecars(): void {
  window.EditorCollab = EditorCollab;
  window.PresentationEditor = PresentationEditor;
  window.DashboardEditor = DashboardEditor;

  if (!window.presentationEditor) {
    window.presentationEditor = new PresentationEditor({ slides: [], currentSlide: 0 });
  }
  if (!window.dashboardEditor) {
    window.dashboardEditor = new DashboardEditor({ widgets: [] });
  }
}
