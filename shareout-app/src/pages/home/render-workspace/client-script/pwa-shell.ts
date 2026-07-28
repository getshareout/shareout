/** Register the app-shell service worker on /home (ignored when unsupported). */
export const workspace_client_pwa_shell_JS = `
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
`;
