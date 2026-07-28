/**
 * First-boot setup for self-host / OSS (work/047 Phase 3).
 * Empty users table ⇒ show /setup; first signed-in user becomes admin.
 *
 * Secrets cannot be written from the Worker — checklist shows wrangler commands.
 */
import type { Env } from '../types';
import { renderHtmlPage } from '../design-system/shell';
import { authPageStyles } from '../design-system/pages/auth.css';
import { brandMarkImg } from '../brand';
import { googleOAuthConfigured } from '../config/auth-providers';
import { getPlatformOrigin } from '../config/origins';
import { escapeHtml } from '../html/utils';

/** True while the instance has no users yet — the first-admin claim flow. */
export async function needsSetup(env: Env): Promise<boolean> {
  try {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>();
    return !row || Number(row.n) === 0;
  } catch {
    // Migrations not applied yet — still treat as setup needed.
    return true;
  }
}

/**
 * Whether the D1 schema has been applied.
 *
 * The Deploy-to-Cloudflare button provisions the D1 database but does not run
 * migrations, so a button-deployed instance starts with an empty database and no
 * tables. Every query then fails with `no such table`, which surfaces as an opaque
 * 500 — the operator sees "Internal server error" and has nothing to act on.
 * Detecting it lets `/setup` name the one command that fixes it.
 */
export async function schemaReady(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

export type SetupStatus = {
  hasSessionSecret: boolean;
  hasBaseUrl: boolean;
  google: boolean;
  setupEmail: string;
  origin: string;
};

export function getSetupStatus(env: Env): SetupStatus {
  return {
    hasSessionSecret: Boolean(env.SESSION_SECRET?.trim()),
    hasBaseUrl: Boolean(env.SHAREOUT_BASE_URL?.trim()),
    google: googleOAuthConfigured(env),
    setupEmail: env.SETUP_ADMIN_EMAIL?.trim() || '',
    origin: getPlatformOrigin(env),
  };
}

function checkRow(ok: boolean, label: string, hint: string): string {
  const mark = ok ? '✓' : '○';
  const cls = ok ? 'ok' : 'todo';
  return `<li class="${cls}"><span class="mark">${mark}</span> <strong>${escapeHtml(label)}</strong> — ${escapeHtml(hint)}</li>`;
}

function codeBlock(cmd: string): string {
  return `<pre class="setup-code"><code>${escapeHtml(cmd)}</code></pre>`;
}

/** Posts the first-admin form and lands on /home once the session cookie is set. */
function setupScript(): string {
  return `<script>
(function () {
  var form = document.getElementById('setup-form');
  var status = document.getElementById('setup-status');
  if (!form) return;
  function show(msg, bad) {
    status.hidden = false;
    status.textContent = msg;
    status.className = bad ? 'status status--error' : 'status';
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    show('Creating your account…', false);
    fetch('/v1/auth/password/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email.value.trim(),
        password: form.password.value
      })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    }).then(function (res) {
      if (res.ok && res.data.ok) { window.location.href = '/home'; return; }
      btn.disabled = false;
      show(res.data.error || 'Could not create the account.', true);
    }).catch(function () {
      btn.disabled = false;
      show('Network error — try again.', true);
    });
  });
})();
</script>`;
}

export async function renderSetupPage(env: Env): Promise<Response> {
  const { hasSessionSecret, hasBaseUrl, google, setupEmail, origin } = getSetupStatus(env);
  const hasSchema = await schemaReady(env);
  // Both are hard prerequisites: no secret means no session to mint, no schema means
  // no table to write the account into.
  const ready = hasSessionSecret && hasSchema;

  const secretHelp = hasSessionSecret
    ? ''
    : `<div class="setup-warn">
      <p><strong>Required before sign-in:</strong> set a session secret on this Worker.</p>
      ${codeBlock('npx wrangler secret put SESSION_SECRET')}
      <p class="auth-help">Generate one with <code>openssl rand -hex 32</code>, paste when prompted, then refresh this page.</p>
    </div>`;

  const schemaHelp = hasSchema
    ? ''
    : `<div class="setup-warn">
      <p><strong>Required before anything works:</strong> the database has no tables yet. The Deploy button creates the D1 database but does not apply the schema.</p>
      ${codeBlock('npx wrangler d1 migrations apply DB --remote')}
      <p class="auth-help">Run it from a checkout of this repo (in <code>shareout-app/</code>), then refresh this page.</p>
    </div>`;

  // Unset, every agent-facing URL this instance hands out — the skill, the discovery
  // documents, the OpenAPI servers block — names the hosted instance instead, so
  // agents publish this instance's content to someone else's server.
  const baseUrlHelp = hasBaseUrl
    ? ''
    : `<div class="setup-warn">
      <p><strong>Set before agents use this instance:</strong> <code>SHAREOUT_BASE_URL</code> is unset, so the skill and API docs served from here still point at <span class="email">${escapeHtml(origin)}</span> — anything an agent publishes would land there, not on this Worker.</p>
      ${codeBlock('# in wrangler.toml [vars]\nSHAREOUT_BASE_URL = "https://your-instance.example.com"')}
      <p class="auth-help">Use this Worker's own URL, with no trailing slash, then redeploy.</p>
    </div>`;

  const optionalHelp = `
    <details class="setup-optional">
      <summary>Optional (Google, admin email hint)</summary>
      <p>Google OAuth — skip unless you want “Sign in with Google”:</p>
      ${codeBlock('npx wrangler secret put GOOGLE_CLIENT_ID\nnpx wrangler secret put GOOGLE_CLIENT_SECRET')}
      <p>Pin the first admin email (otherwise the first account becomes admin):</p>
      ${codeBlock('# in wrangler.toml [vars]\nSETUP_ADMIN_EMAIL = "you@example.com"')}
    </details>`;

  // The admin account is created right here, with a password. Sending the operator
  // to email OTP instead would mean they cannot finish setup until they have stood
  // up a mail provider — and without one the code only appears in the worker log.
  const adminForm = ready
    ? `<form id="setup-form" class="setup-form" autocomplete="on">
      <label class="setup-label" for="setup-email">Admin email</label>
      <input class="so-c-input" id="setup-email" name="email" type="email" autocomplete="username"
             required ${setupEmail ? `value="${escapeHtml(setupEmail)}" readonly` : 'placeholder="you@example.com"'}>
      <label class="setup-label" for="setup-password">Password</label>
      <input class="so-c-input" id="setup-password" name="password" type="password"
             autocomplete="new-password" required minlength="12" placeholder="At least 12 characters">
      <p class="auth-help setup-hint">Length is what makes this hard to guess — a short phrase beats a short scramble.</p>
      <button class="so-c-btn so-c-btn--primary so-c-btn--block" type="submit">Create admin account</button>
      <div id="setup-status" class="status" role="status" aria-live="polite" hidden></div>
    </form>
    ${google ? '<p class="auth-help">Or <a href="/auth/login?redirect=%2Fhome">sign in with Google</a>.</p>' : ''}`
    : `<button class="so-c-btn so-c-btn--primary so-c-btn--block" type="button" disabled>${
        hasSchema ? 'Set SESSION_SECRET first' : 'Apply the database schema first'
      }</button>`;

  const body = `
  <div class="card">
    <div class="icon icon-primary">${brandMarkImg('setup-mark', 28)}</div>
    <h1>Set up ShareOut</h1>
    <p>Self-hosted instance with no users yet. Create the admin account to finish.</p>
    <ul class="setup-checks">
      ${checkRow(hasSchema, 'Database schema', hasSchema ? 'applied' : 'not applied — run the migration below')}
      ${checkRow(hasSessionSecret, 'Session secret', hasSessionSecret ? 'configured' : 'missing — use the command below')}
      ${checkRow(hasBaseUrl, 'Instance URL', hasBaseUrl ? origin : 'unset — agents would publish to the hosted instance')}
      ${checkRow(true, 'Password sign-in', 'ready — no email or OAuth needed')}
      ${checkRow(google, 'Google OAuth', google ? 'enabled' : 'optional — not configured')}
      ${checkRow(Boolean(setupEmail), 'Admin email hint', setupEmail || 'optional SETUP_ADMIN_EMAIL')}
    </ul>
    ${schemaHelp}
    ${secretHelp}
    ${baseUrlHelp}
    ${adminForm}
    ${optionalHelp}
    <p class="auth-help">Origin: <span class="email">${escapeHtml(origin)}</span></p>
    <div class="footer">Powered by <a href="/">ShareOut</a></div>
  </div>
  ${ready ? setupScript() : ''}
  <style>
    .setup-form { text-align: left; margin: 0 0 1rem; }
    .setup-label { display: block; margin: 0.6rem 0 0.25rem; font-size: 0.85rem; font-weight: 600; }
    .setup-hint { margin: 0.4rem 0 0.9rem; }
    .setup-checks { list-style: none; padding: 0; margin: 0 0 1.25rem; text-align: left; }
    .setup-checks li { display: flex; gap: 0.5rem; margin: 0.4rem 0; font-size: 0.92rem; color: var(--color-text-secondary); }
    .setup-checks .mark { width: 1.2rem; flex: none; }
    .setup-checks .ok .mark { color: var(--color-primary); }
    .setup-warn { text-align: left; margin: 0 0 1rem; padding: 0.75rem 0.9rem; border: 1px solid var(--color-border, #e5e5e5); border-radius: 8px; background: var(--color-bg-elevated, #fff); }
    .setup-warn p { margin: 0.35rem 0; font-size: 0.9rem; }
    .setup-code { margin: 0.5rem 0; padding: 0.65rem 0.75rem; overflow-x: auto; font-size: 0.8rem; border-radius: 6px; background: #0f172a; color: #e2e8f0; text-align: left; }
    .setup-optional { text-align: left; margin: 0 0 1rem; font-size: 0.9rem; color: var(--color-text-secondary); }
    .setup-optional summary { cursor: pointer; margin-bottom: 0.5rem; }
    .so-c-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  </style>`;

  return renderHtmlPage({
    title: 'Setup - ShareOut',
    pageStyles: authPageStyles,
    body,
  });
}
