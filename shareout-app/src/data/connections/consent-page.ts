import type { Env } from '../../types';
import { getSessionUser } from '../../auth/session';
import { errorPage } from '../../auth/pages';
import { renderHtmlPage } from '../../design-system/shell';
import { authPageStyles } from '../../design-system/pages/auth.css';
import { escapeHtml } from '../../html/utils';
import { loadConsentTarget, setConnectionConsent } from './consent';

export async function handleConsentPage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const post = request.method === 'POST';
  let artifactId = url.searchParams.get('artifact') || '';
  let connection = url.searchParams.get('connection') || '';
  let decision = '';
  if (post) {
    const site = request.headers.get('Sec-Fetch-Site');
    const sameOrigin = site ? site === 'same-origin' : request.headers.get('Origin') === url.origin;
    if (!sameOrigin) return errorPage('That request did not come from ShareOut.', '/');
    const form = await request.formData().catch(() => null);
    artifactId = String(form?.get('artifact') || '');
    connection = String(form?.get('connection') || '');
    decision = String(form?.get('decision') || '');
  }
  if (!artifactId || !connection) return errorPage('This approval link is incomplete.', '/');

  const session = await getSessionUser(request, env);
  if (!session) {
    return Response.redirect(`${url.origin}/auth/login?redirect=${encodeURIComponent(`${url.pathname}${url.search}`)}`, 302);
  }
  const target = await loadConsentTarget(env, artifactId, connection, session.id);
  if (!target) return errorPage('This connector is not available to you for that page.', '/');

  if (post) {
    await setConnectionConsent(env, session.id, artifactId, target.conn.id, decision === 'approve');
    return renderHtmlPage({
      title: 'Connector access - ShareOut',
      pageStyles: authPageStyles,
      cacheControl: 'no-store',
      body: `
    <div class="card">
      <h1>${decision === 'approve' ? 'Approved' : 'Denied'}</h1>
      <p>${decision === 'approve' ? 'You can go back to the page and retry.' : 'The page will not be able to use your credentials.'}</p>
      <div class="footer">Powered by <a href="/">ShareOut</a></div>
    </div>`,
    });
  }

  const hidden = `<input type="hidden" name="artifact" value="${escapeHtml(artifactId)}"><input type="hidden" name="connection" value="${escapeHtml(connection)}">`;
  return renderHtmlPage({
    title: 'Connector access - ShareOut',
    pageStyles: authPageStyles,
    cacheControl: 'no-store',
    body: `
    <div class="card">
      <h1>Allow this page to use your ${escapeHtml(connection)} access?</h1>
      <p><strong>${escapeHtml(target.artifact.name)}</strong>${target.artifact.owner ? ` by ${escapeHtml(target.artifact.owner)}` : ''} wants to run queries on the <strong>${escapeHtml(connection)}</strong> connector using your own saved credentials. It can read and change whatever those credentials allow.</p>
      <p class="auth-help">Signed in as <span class="email">${escapeHtml(session.email)}</span></p>
      <form method="POST" action="/connect-consent">
        ${hidden}
        <button type="submit" name="decision" value="approve" class="so-c-btn so-c-btn--primary so-c-btn--block">Approve</button>
        <button type="submit" name="decision" value="deny" class="so-c-btn so-c-btn--secondary so-c-btn--block">Deny</button>
      </form>
      <div class="footer">Powered by <a href="/">ShareOut</a></div>
    </div>`,
  });
}
