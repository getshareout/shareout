// ShareOut Visual Editor - Page generation types

export interface EditorPageOptions {
  artifactId: string;
  slug: string;
  /** Origin the editor client calls for data. Must be THIS instance: the client
   *  fetches `${baseUrl}/v1/data/...` with `credentials: 'include'`. */
  baseUrl?: string;
  theme?: 'light' | 'dark' | 'auto';
  name?: string;
  description?: string;
  userId?: string;
  userName?: string;
  userAvatar?: string;
  openVisDisabled?: boolean;
  /** When false, Agent pane shows a configure hint instead of accepting prompts. */
  aiEnabled?: boolean;
}

export interface EditorConfigScriptOptions {
  artifactId: string;
  slug: string;
  theme: 'light' | 'dark' | 'auto';
  baseUrl: string;
  name?: string;
  description?: string;
  userId?: string;
  userName?: string;
  userAvatar?: string;
  openVisDisabled?: boolean;
  aiEnabled?: boolean;
}
