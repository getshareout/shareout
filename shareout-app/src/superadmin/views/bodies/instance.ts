/**
 * "What is this instance configured for, and what can I do about it?"
 *
 * buildInstanceConfig() has answered the first half since #47, but nothing rendered
 * it — the only way to read it was to curl /v1/admin/instance. Same for the two write
 * endpoints: an instance owner could provision a workspace or appoint an admin over
 * the API and had no button for either. This is the front end for all three.
 */
import { escapeHtml } from '../../../html/utils';
import type { InstanceConfig } from '../../instance-config';
import { card, bytes, stat2, fmt } from '../components';

function yesNo(on: boolean): string {
  return on
    ? '<span style="color:var(--color-success,#16a34a)">Yes</span>'
    : '<span class="sa-muted">No</span>';
}

function kv(label: string, value: string): string {
  return `<tr><td>${escapeHtml(label)}</td><td class="sa-num">${value}</td></tr>`;
}

function settingsTable(rows: string): string {
  return `<table class="sa-table"><tbody>${rows}</tbody></table>`;
}

function gapsCard(cfg: InstanceConfig): string {
  if (!cfg.gaps.length) {
    return card(
      'Nothing unset',
      '<p class="sa-muted">Every optional setting this build reads is configured. Features are on because they have what they need, not because nobody checked.</p>',
    );
  }
  const rows = cfg.gaps
    .map(
      (g) => `<tr>
        <td><code>${escapeHtml(g.setting)}</code></td>
        <td>${escapeHtml(g.disables)}</td>
        <td class="sa-muted"><code>${escapeHtml(g.fix)}</code></td>
      </tr>`,
    )
    .join('');
  return card(
    `Unset — and what each one costs (${cfg.gaps.length})`,
    `<table class="sa-table">
      <thead><tr><th>Setting</th><th>What stays off</th><th>Fix</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`,
  );
}

export function instanceBody(cfg: InstanceConfig): string {
  const identity = settingsTable(
    kv('Origin', `<code>${escapeHtml(cfg.origin)}</code>`) +
      kv(
        'Database schema',
        cfg.schema === 'ready'
          ? yesNo(true)
          : '<span style="color:var(--color-error)">Migrations not applied</span>',
      ),
  );

  const signIn = settingsTable(
    kv('Email &amp; password', yesNo(true)) +
      kv('Google sign-in', yesNo(cfg.auth.google)) +
      kv(
        'One-time codes',
        cfg.auth.email_otp_delivery === 'email'
          ? 'Emailed'
          : '<span class="sa-muted">Written to the Worker log (no email binding)</span>',
      ),
  );

  const ai = settingsTable(
    kv(
      'Providers',
      cfg.ai.providers.length
        ? cfg.ai.providers.map((p) => `<code>${escapeHtml(p)}</code>`).join(' → ')
        : '<span style="color:var(--color-error)">None — every AI feature is inert</span>',
    ) + kv('Workspaces can use their own key', yesNo(cfg.ai.byo_keys)),
  );

  const email = settingsTable(
    kv('Email binding', yesNo(cfg.email.binding)) +
      kv('Default sender', cfg.email.default_from ? `<code>${escapeHtml(cfg.email.default_from)}</code>` : '—') +
      kv('Inbound domain', cfg.email.inbox_domain ? `<code>${escapeHtml(cfg.email.inbox_domain)}</code>` : '—'),
  );

  const sharing = settingsTable(
    kv('Public artifacts allowed', yesNo(cfg.sharing.open_visibility)) +
      kv('Sign-ups paused', yesNo(cfg.sharing.signups_paused)) +
      kv('ShareOut badge on artifacts', yesNo(cfg.sharing.artifact_badge)) +
      kv(
        'Artifacts served from',
        cfg.sharing.artifact_origin ? `<code>${escapeHtml(cfg.sharing.artifact_origin)}</code>` : 'Same origin',
      ),
  );

  const storage = settingsTable(
    kv('Workspace quota', cfg.storage.quota_bytes > 0 ? bytes(cfg.storage.quota_bytes) : 'Unlimited') +
      kv('Max upload', cfg.storage.max_file_bytes > 0 ? bytes(cfg.storage.max_file_bytes) : 'Unlimited') +
      kv(
        'Daily bandwidth per owner',
        cfg.storage.daily_bandwidth_bytes_per_owner > 0
          ? bytes(cfg.storage.daily_bandwidth_bytes_per_owner)
          : 'Unlimited',
      ),
  );

  const b = cfg.bindings;
  const bindings = settingsTable(
    kv('Durable Objects (realtime, tables)', yesNo(b.durable_objects)) +
      kv('Workers AI', yesNo(b.workers_ai)) +
      kv('Vectorize (search)', yesNo(b.vectorize)) +
      kv('Browser (screenshots, PDF)', yesNo(b.browser)) +
      kv('Views queue', yesNo(b.views_queue)) +
      kv('Rate-limit KV', yesNo(b.rate_limit_kv)),
  );

  const admins = settingsTable(
    kv('Instance admins configured', yesNo(cfg.admins.configured)) +
      kv('SETUP_ADMIN_EMAIL set', yesNo(cfg.admins.setup_admin_email)),
  );

  // Both forms POST to endpoints that already existed with no caller.
  const createWorkspace = card(
    'Create a workspace',
    `<p class="sa-muted" style="margin-bottom:var(--space-3)">The owner does not have to exist yet — they land in it on first sign-in.</p>
     <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center">
       <input id="sa-ws-name" class="so-c-input" type="text" placeholder="Workspace name" autocomplete="off">
       <input id="sa-ws-owner" class="so-c-input" type="email" placeholder="Owner email" autocomplete="off">
       <input id="sa-ws-slug" class="so-c-input" type="text" placeholder="Slug (optional)" autocomplete="off">
       <button id="sa-ws-create" class="so-c-btn so-c-btn--primary so-c-btn--sm" type="button">Create</button>
     </div>
     <div id="sa-ws-result" class="sa-muted" style="margin-top:var(--space-2)"></div>`,
  );

  const appointAdmin = card(
    'Appoint an admin',
    `<p class="sa-muted" style="margin-bottom:var(--space-3)">Set someone's role in any workspace without being a member of it.</p>
     <input id="sa-appoint-search" class="so-c-input" type="search" placeholder="Search workspaces…" autocomplete="off">
     <div id="sa-appoint-results" class="sa-feat-results"></div>
     <div id="sa-appoint-current" class="sa-muted" style="margin:var(--space-2) 0"></div>
     <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center">
       <input id="sa-appoint-email" class="so-c-input" type="email" placeholder="Person's email" autocomplete="off">
       <select id="sa-appoint-role" class="so-c-select">
         <option value="admin">Admin</option>
         <option value="member">Member</option>
         <option value="owner">Owner</option>
       </select>
       <button id="sa-appoint-btn" class="so-c-btn so-c-btn--primary so-c-btn--sm" type="button" disabled>Set role</button>
     </div>
     <div id="sa-appoint-result" class="sa-muted" style="margin-top:var(--space-2)"></div>`,
  );

  const half = (inner: string) => `<div style="flex:1 1 320px;min-width:0">${inner}</div>`;
  const pair = (a: string, c: string) =>
    `<div style="display:flex;gap:var(--space-4);flex-wrap:wrap;margin-top:var(--space-4)">${half(a)}${half(c)}</div>`;

  return `
    <div class="sa-stats">
      ${stat2(escapeHtml(cfg.origin.replace(/^https?:\/\//, '')), 'This instance')}
      ${stat2(cfg.schema === 'ready' ? 'Ready' : 'Missing', 'Schema')}
      ${stat2(fmt(cfg.gaps.length), cfg.gaps.length === 1 ? 'Setting unset' : 'Settings unset')}
    </div>
    <div style="margin-top:var(--space-4)">${gapsCard(cfg)}</div>
    ${pair(createWorkspace, appointAdmin)}
    ${pair(card('Identity', identity), card('Sign-in', signIn))}
    ${pair(card('AI', ai), card('Email', email))}
    ${pair(card('Sharing', sharing), card('Storage limits', storage))}
    ${pair(card('Bindings', bindings), card('Instance admins', admins))}`;
}
