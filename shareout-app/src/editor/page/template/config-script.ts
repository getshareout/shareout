// ShareOut Visual Editor - Inline window.EDITOR_CONFIG script

import type { EditorConfigScriptOptions } from '../types';

/** Inline script that sets window.EDITOR_CONFIG before client modules load. */
export function renderEditorConfigScript(options: EditorConfigScriptOptions): string {
  const {
    artifactId, slug, theme, baseUrl, name, description, userId, userName, userAvatar,
    openVisDisabled, aiEnabled,
  } = options;
  const config: Record<string, string | boolean> = {
    artifactId,
    slug,
    baseUrl,
    theme,
    name: name || '',
    description: description || '',
    openVisDisabled: !!openVisDisabled,
    // Default true when omitted (older embeds); server always sets explicitly now.
    aiEnabled: aiEnabled !== false,
  };
  if (userId) config.userId = userId;
  if (userName) config.userName = userName;
  if (userAvatar) config.userAvatar = userAvatar;

  const lines = Object.entries(config).map(
    ([key, value]) => `      ${key}: ${JSON.stringify(value)}`
  );

  return `  <script>
    window.EDITOR_CONFIG = {
${lines.join(',\n')}
    };
  </script>`;
}
