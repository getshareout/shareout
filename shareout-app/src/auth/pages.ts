import { renderHtmlPage } from '../design-system/shell';
import { authPageStyles } from '../design-system/pages/auth.css';
import { brandMarkImg } from '../brand';
import { escapeHtml } from '../html/utils';
import { NOINDEX_ROBOTS } from '../serve/utils';
import { turnstileWidgetHtml } from '../turnstile';

/** Auth/access gates for private content: never index, never emit OG of the page or artifact. */
function renderAuthPage(title: string, body: string, status = 200, opts?: { noindex?: boolean }): Response {
  const noindex = opts?.noindex !== false;
  return renderHtmlPage({
    title,
    pageStyles: authPageStyles,
    body,
    status,
    // No OG/Twitter tags at all — unfurlers must not advertise private gates.
    noSocial: true,
    // Explicit robots meta + header so scrapers that ignore one still see the other.
    extraHead: noindex ? `<meta name="robots" content="${NOINDEX_ROBOTS}">` : '',
    extraHeaders: noindex ? { 'X-Robots-Tag': NOINDEX_ROBOTS } : undefined,
  });
}

export function linkSuccessPage(email: string, redirectTo: string): Response {
  return renderAuthPage('Account Linked - ShareOut', `
  <div class="card">
    <div class="icon icon-success">✓</div>
    <h1>Account Linked!</h1>
    <p>Your Google account <span class="email">${escapeHtml(email)}</span> has been linked. You can now sign in with Google.</p>
    <a href="${escapeHtml(redirectTo)}" class="so-c-btn so-c-btn--primary so-c-btn--block">Continue</a>
  </div>`);
}

export function errorPage(message: string, redirectTo: string): Response {
  return renderAuthPage('Error - ShareOut', `
  <div class="card">
    <div class="icon icon-error">!</div>
    <h1 class="error">Oops!</h1>
    <p>${escapeHtml(message)}</p>
    <a href="${escapeHtml(redirectTo)}" class="so-c-btn so-c-btn--primary so-c-btn--block">Go back</a>
  </div>`, 400);
}

export function loginPage(
  slug: string,
  _artifactName?: string,
  _socialPreview?: unknown,
  turnstileSiteKey?: string,
  sharedBy?: string,
  googleEnabled = true,
): Response {
  // Private-by-default gates must not reveal title, description, or thumbnail to
  // unauthorized visitors (or crawlers). Optional sharedBy is a first-name hint only
  // when the page was deliberately shared with collaborators / workspace members.
  const subtitle = sharedBy
    ? `Shared with you by <strong>${escapeHtml(sharedBy)}</strong>. Sign in to view it.`
    : 'This content is private. Sign in to continue.';
  const redirect = `/a/${escapeHtml(slug)}/`;
  return renderAuthPage('Sign in - ShareOut', `
  <div class="card card-share">
    <div class="icon icon-primary">🔒</div>
    <h1 class="share-title">Private content</h1>
    <p class="share-subtitle">${subtitle}</p>
    <div class="auth-methods">
    ${googleEnabled ? googleButtonHtml(redirect) : ''}
    ${googleEnabled ? '<div class="auth-divider"><span>or</span></div>' : ''}
    ${emailOtpFormsHtml(turnstileSiteKey)}
    <div id="email-code-status" class="status" role="status" aria-live="polite" hidden></div>
    </div>
    <div class="footer">
      Powered by <a href="/" class="footer-brand">${brandMarkImg('footer-mark', 16)}ShareOut</a>
    </div>
  </div>
  ${emailOtpScript(redirect)}`, 401);
}

/** App-shell sign-in (home, settings, admin) — email OTP always; Google when configured. */
export function appLoginPage(opts: {
  redirect?: string;
  turnstileSiteKey?: string;
  googleEnabled?: boolean;
  loginHint?: string | null;
  /** EMAIL binding present. Without it, OTP codes only reach the worker log. */
  emailConfigured?: boolean;
}): Response {
  const redirect = opts.redirect && opts.redirect.startsWith('/') ? opts.redirect : '/home';
  const googleEnabled = opts.googleEnabled === true;
  const emailConfigured = opts.emailConfigured !== false;

  // Password first: it is the one method that works on every instance. A one-time
  // code needs mail delivery, and offering it as the primary route on an instance
  // with no EMAIL binding sends people to a code that only appears in a log.
  const otpSection = `
    <details class="auth-alt"${emailConfigured ? ' open' : ''}>
      <summary>Email me a one-time code instead</summary>
      ${emailConfigured ? '' : '<p class="auth-help">This instance has no email binding configured, so the code is written to the Worker log rather than sent.</p>'}
      ${emailOtpFormsHtml(opts.turnstileSiteKey)}
      <div id="email-code-status" class="status" role="status" aria-live="polite" hidden></div>
    </details>`;

  return renderAuthPage('Sign in - ShareOut', `
  <div class="card">
    <div class="icon icon-primary">✦</div>
    <h1>Sign in</h1>
    <p>Use your email and password${googleEnabled ? ', or Google,' : ''} to continue.</p>
    <div class="auth-methods">
    ${googleEnabled ? googleButtonHtml(redirect, opts.loginHint) : ''}
    ${googleEnabled ? '<div class="auth-divider"><span>or</span></div>' : ''}
    ${passwordFormHtml()}
    ${otpSection}
    </div>
    <div class="footer">
      Powered by <a href="/" class="footer-brand">${brandMarkImg('footer-mark', 16)}ShareOut</a>
    </div>
  </div>
  ${passwordLoginScript(redirect)}
  ${emailOtpScript(redirect)}`);
}

function passwordFormHtml(): string {
  return `<form id="password-login" class="email-code-form" novalidate>
      <div class="field">
        <label class="field-label" for="password-email">Email address</label>
        <input id="password-email" type="email" name="email" autocomplete="username" placeholder="you@company.com" required>
      </div>
      <div class="field">
        <label class="field-label" for="password-value">Password</label>
        <input id="password-value" type="password" name="password" autocomplete="current-password" required>
      </div>
      <button type="submit" class="so-c-btn so-c-btn--primary so-c-btn--block">Sign in</button>
      <div id="password-status" class="status" role="status" aria-live="polite" hidden></div>
    </form>`;
}

function passwordLoginScript(redirectAfter: string): string {
  const dest = JSON.stringify(redirectAfter);
  return `<script>
(function () {
  var form = document.getElementById('password-login');
  var status = document.getElementById('password-status');
  if (!form) return;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    status.hidden = true;
    fetch('/v1/auth/password/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email.value.trim(), password: form.password.value })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    }).then(function (res) {
      if (res.ok && res.data.ok) { window.location.href = ${dest}; return; }
      btn.disabled = false;
      status.hidden = false;
      status.className = 'status status--error';
      status.textContent = res.data.error || 'Sign in failed.';
    }).catch(function () {
      btn.disabled = false;
      status.hidden = false;
      status.className = 'status status--error';
      status.textContent = 'Network error — try again.';
    });
  });
})();
</script>`;
}

function googleButtonHtml(redirect: string, loginHint?: string | null): string {
  const hint = loginHint ? `&login_hint=${encodeURIComponent(loginHint)}` : '';
  return `<a href="/auth/google?redirect=${encodeURIComponent(redirect)}${hint}" class="btn btn-google">
      <svg viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Sign in with Google
    </a>`;
}

function emailOtpFormsHtml(turnstileSiteKey?: string): string {
  return `<form id="email-code-start" class="email-code-form" novalidate>
      <div class="field">
        <label class="field-label" for="email-code-email">Email address</label>
        <input id="email-code-email" type="email" name="email" autocomplete="email" placeholder="you@company.com" required>
      </div>
      ${turnstileWidgetHtml(turnstileSiteKey)}
      <button id="email-code-send" type="submit" class="so-c-btn so-c-btn--primary so-c-btn--block">Send code</button>
    </form>
    <form id="email-code-verify" class="email-code-form" hidden novalidate>
      <p class="auth-help">We sent a 6-digit code to <span id="email-code-target" class="email"></span>.</p>
      <div class="field">
        <label class="field-label" for="email-code-code">One-time code</label>
        <input id="email-code-code" type="text" name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="123456" required>
      </div>
      <button id="email-code-continue" type="submit" class="so-c-btn so-c-btn--primary so-c-btn--block">Continue</button>
      <button id="email-code-change" type="button" class="so-c-btn so-c-btn--secondary so-c-btn--block">Use another email</button>
    </form>`;
}

function emailOtpScript(redirectAfter: string): string {
  const dest = JSON.stringify(redirectAfter);
  return `<script>
  (function () {
    var startForm = document.getElementById('email-code-start');
    var verifyForm = document.getElementById('email-code-verify');
    var emailInput = document.getElementById('email-code-email');
    var codeInput = document.getElementById('email-code-code');
    var sendButton = document.getElementById('email-code-send');
    var continueButton = document.getElementById('email-code-continue');
    var changeButton = document.getElementById('email-code-change');
    var statusBox = document.getElementById('email-code-status');
    var target = document.getElementById('email-code-target');
    var pendingEmail = '';
    var redirectAfter = ${dest};

    if (!startForm || !verifyForm || !emailInput || !codeInput || !sendButton || !continueButton || !changeButton || !statusBox || !target || !window.fetch) {
      return;
    }

    function setStatus(message, kind) {
      statusBox.textContent = message || '';
      statusBox.className = 'status' + (kind ? ' status-' + kind : '');
      statusBox.hidden = !message;
    }

    function setBusy(button, busy, label) {
      button.disabled = busy;
      if (label) button.textContent = label;
    }

    async function readJson(response) {
      try {
        return await response.json();
      } catch (_err) {
        return {};
      }
    }

    startForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var email = emailInput.value.trim().toLowerCase();
      if (!email) {
        setStatus('Enter your email address.', 'error');
        emailInput.focus();
        return;
      }

      setBusy(sendButton, true, 'Sending...');
      setStatus('', '');
      try {
        var tsEl = startForm.querySelector('[name="cf-turnstile-response"]');
        var response = await fetch('/v1/auth/email/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, turnstileToken: tsEl ? tsEl.value : undefined })
        });
        var data = await readJson(response);
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Couldn't send a code. Try again.");
        }

        pendingEmail = email;
        target.textContent = email;
        startForm.hidden = true;
        verifyForm.hidden = false;
        setStatus('Check your email for the code.', 'success');
        codeInput.focus();
      } catch (err) {
        setStatus(err && err.message ? err.message : "Couldn't send a code. Try again.", 'error');
      } finally {
        setBusy(sendButton, false, 'Send code');
      }
    });

    verifyForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var code = codeInput.value.trim();
      if (!/^[0-9]{6}$/.test(code)) {
        setStatus('Enter the 6-digit code from your email.', 'error');
        codeInput.focus();
        return;
      }

      setBusy(continueButton, true, 'Checking...');
      setStatus('', '');
      try {
        var response = await fetch('/v1/auth/email/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: pendingEmail, code: code })
        });
        var data = await readJson(response);
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "That code didn't work. Try again.");
        }

        setStatus('Signed in…', 'success');
        window.location.href = redirectAfter || '/home';
      } catch (err) {
        setStatus(err && err.message ? err.message : "That code didn't work. Try again.", 'error');
        setBusy(continueButton, false, 'Continue');
      }
    });

    changeButton.addEventListener('click', function () {
      pendingEmail = '';
      codeInput.value = '';
      verifyForm.hidden = true;
      startForm.hidden = false;
      setStatus('', '');
      emailInput.focus();
    });
  }());
  </script>`;
}

export function accessDeniedPage(opts: {
  slug: string;
  /** @deprecated ignored — private gates must not reveal the artifact title */
  artifactName?: string;
  userEmail?: string | null;
  requestPending?: boolean;
  /** @deprecated ignored — no OG tags on private gates */
  socialPreview?: unknown;
}): Response {
  const {
    slug, userEmail, requestPending,
  } = opts;

  const signedIn = userEmail
    ? `<p class="access-signed-in">Signed in as <span class="email">${escapeHtml(userEmail)}</span></p>`
    : '';

  const requestBlock = userEmail
    ? (requestPending
      ? `<div class="status status-success" role="status">Access request sent. The owner will be notified.</div>`
      : `<button type="button" class="so-c-btn so-c-btn--primary so-c-btn--block" id="accessRequestBtn" data-slug="${escapeHtml(slug)}">Request access</button>
         <div id="accessRequestStatus" class="status" role="status" aria-live="polite" hidden></div>`)
    : `<p class="auth-help">Sign in with an email address to request access.</p>`;

  return renderAuthPage('You need access - ShareOut', `
  <div class="card card-access">
    <div class="access-lock" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    </div>
    <h1>You need access</h1>
    <p>This content is private. Ask the owner for permission, or try a different account.</p>
    ${signedIn}
    <div class="actions actions-stack">
      ${requestBlock}
      <a href="/auth/logout?redirect=/a/${escapeHtml(slug)}/" class="so-c-btn so-c-btn--secondary so-c-btn--block">Switch account</a>
    </div>
    <div class="footer">
      Powered by <a href="/" class="footer-brand">${brandMarkImg('footer-mark', 16)}ShareOut</a>
    </div>
  </div>
  <script>
  (function () {
    var btn = document.getElementById('accessRequestBtn');
    var status = document.getElementById('accessRequestStatus');
    if (!btn || !status || !window.fetch) return;

    function setStatus(message, kind) {
      status.textContent = message || '';
      status.className = 'status' + (kind ? ' status-' + kind : '');
      status.hidden = !message;
    }

    btn.addEventListener('click', async function () {
      btn.disabled = true;
      setStatus('', '');
      try {
        var response = await fetch('/v1/access-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ slug: btn.getAttribute('data-slug') })
        });
        var data = {};
        try { data = await response.json(); } catch (_e) {}
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Couldn't send your request. Try again.");
        }
        btn.remove();
        setStatus(data.message || 'Access request sent. The owner will be notified.', 'success');
      } catch (err) {
        setStatus(err && err.message ? err.message : "Couldn't send your request. Try again.", 'error');
        btn.disabled = false;
      }
    });
  }());
  </script>`, 403);
}

export function passwordLoginPage(
  slug: string,
  _artifactName?: string,
  error?: string,
  _socialPreview?: unknown,
  artifactId?: string,
): Response {
  // Always 401 — a 200 password form was indexable and advertised the page title.
  return renderAuthPage('Enter Password - ShareOut', `
  <div class="card">
    <div class="icon icon-primary">🔐</div>
    <h1>Password required</h1>
    <p>Enter the password to view this content.</p>
    ${error ? `<div class="error-box">${escapeHtml(error)}</div>` : ''}
    <form method="POST" action="/auth/password">
      <input type="hidden" name="slug" value="${escapeHtml(slug)}">
      ${artifactId ? `<input type="hidden" name="artifact_id" value="${escapeHtml(artifactId)}">` : ''}
      <input type="password" name="password" placeholder="Password" required autofocus>
      <button type="submit" class="so-c-btn so-c-btn--primary so-c-btn--block">Unlock</button>
    </form>
    <div class="footer">
      Powered by <a href="/" class="footer-brand">${brandMarkImg('footer-mark', 16)}ShareOut</a>
    </div>
  </div>`, 401);
}

export function credentialsLoginPage(
  slug: string,
  _artifactName?: string,
  error?: string,
  _socialPreview?: unknown,
  artifactId?: string,
): Response {
  return renderAuthPage('Sign in - ShareOut', `
  <div class="card">
    <div class="icon icon-primary">🔒</div>
    <h1>Sign in required</h1>
    <p>Sign in with your credentials to view this content.</p>
    ${error ? `<div class="error-box">${escapeHtml(error)}</div>` : ''}
    <form method="POST" action="/auth/credentials">
      <input type="hidden" name="slug" value="${escapeHtml(slug)}">
      ${artifactId ? `<input type="hidden" name="artifact_id" value="${escapeHtml(artifactId)}">` : ''}
      <input type="text" name="username" placeholder="Username" required autofocus>
      <input type="password" name="password" placeholder="Password" required>
      <button type="submit" class="so-c-btn so-c-btn--primary so-c-btn--block">Sign In</button>
    </form>
    <div class="footer">
      Powered by <a href="/" class="footer-brand">${brandMarkImg('footer-mark', 16)}ShareOut</a>
    </div>
  </div>`, 401);
}
