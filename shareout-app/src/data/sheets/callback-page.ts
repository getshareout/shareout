import { googleFontsPreconnect, standalonePageStyles } from '../../design-system/standalone-page';

export function renderCallbackPage(
  success: boolean,
  message: string,
  baseUrl: string,
  redirectUrl?: string | null
): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${success ? 'Connected' : 'Error'} - ShareOut</title>
  ${googleFontsPreconnect}
  <style>${standalonePageStyles}</style>
</head>
<body>
  <div class="card">
    <div class="icon ${success ? 'success' : 'error'}">${success ? '✓' : '✕'}</div>
    <h1>${success ? 'Connected!' : 'Connection Failed'}</h1>
    <p>${message}</p>
    <p class="close-hint">${success ? 'You can close this window and return to your app.' : 'Please try again.'}</p>
  </div>
  <script>
    ${redirectUrl ? `setTimeout(() => window.location.href = '${redirectUrl}', 2000);` : ''}
    window.opener?.postMessage({ type: 'shareout_sheets_${success ? 'connected' : 'error'}', message: '${message}' }, '*');
  </script>
</body>
</html>`;

  return new Response(html, {
    status: success ? 200 : 400,
    headers: { 'Content-Type': 'text/html' },
  });
}
