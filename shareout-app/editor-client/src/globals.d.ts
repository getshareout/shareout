export {};

declare global {
  interface EditorConfig {
    artifactId: string;
    slug: string;
    baseUrl: string;
    theme: string;
    name?: string;
    description?: string;
    userId?: string;
    userName?: string;
    userAvatar?: string;
    openVisDisabled?: boolean;
    /** False when this instance has no AI API key configured. */
    aiEnabled?: boolean;
  }

  interface Window {
    EDITOR_CONFIG: EditorConfig;
    ShareOut?: ShareOutGlobal;
    ShareOutCharts?: ShareOutChartsGlobal;
    EditorCollab?: typeof import('./sidecars/editor-collab').EditorCollab;
    PresentationEditor?: typeof import('./sidecars/presentation-editor').PresentationEditor;
    DashboardEditor?: typeof import('./sidecars/dashboard-editor').DashboardEditor;
    presentationEditor?: import('./sidecars/presentation-editor').PresentationEditor;
    dashboardEditor?: import('./sidecars/dashboard-editor').DashboardEditor;
    applyPendingChanges?: () => void;
    rejectPendingChanges?: () => void;
  }

  type ShareOutGlobal =
    | (new () => unknown)
    | { default?: new () => unknown; ShareOut?: new () => unknown };

  type ShareOutChartsGlobal =
    | (new () => unknown)
    | { default?: new () => unknown; ShareOutCharts?: new () => unknown };

  interface EditorCollabInstance {
    connect(): void;
    attachDoc(doc: import('yjs').Doc): void;
    setTyping(isTyping: boolean): void;
    releaseLock(selector: string): void;
    acquireLock(selector: string): void;
    updateCursor(x: number, y: number): void;
    updateSelection(selector: string): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    canEdit(selector: string): boolean;
    updateTextCursor(elementId: string, offset: number): void;
  }
}
