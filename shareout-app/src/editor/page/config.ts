// ShareOut Visual Editor - Page configuration

export const DEFAULT_EDITOR_BASE_URL = 'https://shareout.site';

/** Base URL for editor API and asset references in generated pages. */
export function getEditorBaseUrl(override?: string): string {
  return override ?? DEFAULT_EDITOR_BASE_URL;
}
