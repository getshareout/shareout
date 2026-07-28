// ShareOut Visual Editor - Page module public API

export { DEFAULT_EDITOR_BASE_URL, getEditorBaseUrl } from './config';
export { generateEditorPage } from './generate-editor-page';
export type { EditorPageOptions } from './types';
export { getEditorStyles } from './styles/editor-styles';
export { EDITOR_CLIENT_SCRIPT_URL } from './generate-editor-page';
export { renderEditorShell } from './template/shell';
export { renderEditorConfigScript } from './template/config-script';
