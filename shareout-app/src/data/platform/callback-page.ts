import { googleFontsPreconnect, standalonePageStyles } from '../../design-system/standalone-page';
import { escapeHtml } from '../../html/utils';

export function renderPlatformConnectionCallbackPage(
	success: boolean,
	providerId: string,
	message: string,
	returnUrl?: string,
): Response {
	const title = success ? 'Connected' : 'Connection Failed';
	const headline = success ? 'Connected!' : 'Connection Failed';
	const icon = success ? '✓' : '✕';
	const eventType = success
		? 'shareout:platform:connected'
		: 'shareout:platform:connection:error';
	const safeMessage = escapeHtml(message);
	const redirect = returnUrl
		? `else { window.location.href = ${JSON.stringify(returnUrl)}; }`
		: '';

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - ShareOut</title>
  ${googleFontsPreconnect}
  <style>${standalonePageStyles}</style>
</head>
<body>
  <div class="card">
    <div class="icon ${success ? 'success' : 'error'}">${icon}</div>
    <h1>${headline}</h1>
    <p>${safeMessage}</p>
    <p class="close-hint">${success ? 'You can close this window and return to your app.' : 'Please try again.'}</p>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({
        type: ${JSON.stringify(eventType)},
        provider: ${JSON.stringify(providerId)},
        message: ${JSON.stringify(message)},
      }, '*');
      window.close();
    } ${redirect}
  </script>
</body>
</html>`;

	return new Response(html, {
		status: success ? 200 : 400,
		headers: { 'Content-Type': 'text/html' },
	});
}
