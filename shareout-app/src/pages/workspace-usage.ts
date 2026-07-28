import type { Env } from '../types';
import { escapeHtml } from '../html/utils';
import { renderHtmlPage } from '../design-system/shell';
import { getInternalWorkspaceRole } from '../workspaces';
import { getWorkspaceStorageLive } from '../storage-snapshots';

const usageStyles = `
.usage-page { max-width: 960px; margin: 0 auto; padding: var(--space-8) var(--space-5) 80px; }
.usage-page h1 { font-size: 1.6rem; margin: 0 0 4px; color: var(--color-text); }
.usage-page .sub { color: var(--color-text-secondary); margin: 0 0 var(--space-8); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-4); margin-bottom: var(--space-8); }
.cards .card { border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-5); background: var(--color-bg-elevated); }
.cards .card .label { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: var(--color-text-secondary); }
.cards .card .value { font-size: 1.5rem; font-weight: 650; margin-top: 6px; color: var(--color-text); }
.cards .card .value.low { color: var(--color-error); }
.section { border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-5); background: var(--color-bg-elevated); margin-bottom: var(--space-6); }
.section h2 { font-size: 1.05rem; margin: 0 0 4px; color: var(--color-text); }
.section .hint { color: var(--color-text-secondary); font-size: .85rem; margin: 0 0 var(--space-4); }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.row select, .row input { padding: 9px 11px; border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: .9rem; background: var(--color-bg-elevated); color: var(--color-text); }
.row input { flex: 1; min-width: 220px; }
.row .so-c-btn { font-size: .9rem; }
.byo-status { display: flex; align-items: center; gap: 10px; padding: var(--space-3) var(--space-4); background: var(--color-success-light); border: 1px solid var(--color-success); border-radius: var(--radius-sm); margin-bottom: var(--space-4); font-size: .9rem; color: var(--color-success); }
.byo-status.platform { background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-secondary); }
table { width: 100%; border-collapse: collapse; font-size: .85rem; }
th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--color-border); }
th { color: var(--color-text-secondary); font-weight: 550; font-size: .72rem; text-transform: uppercase; letter-spacing: .03em; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.tag { display: inline-block; padding: 1px 8px; border-radius: var(--radius-full); font-size: .72rem; background: var(--color-primary-light); color: var(--color-primary); }
.tag.byo { background: var(--color-warning-light); color: var(--color-warning); }
.muted { color: var(--color-text-tertiary); }
.notice { display: none; padding: 10px 14px; border-radius: var(--radius-sm); font-size: .85rem; margin-bottom: var(--space-4); }
.notice.ok { display: block; background: var(--color-success-light); color: var(--color-success); }
.notice.err { display: block; background: var(--color-error-light); color: var(--color-error); }
.credit { border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-5); background: var(--color-bg-elevated); margin-bottom: var(--space-6); }
.credit .credit-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
.credit .credit-head .label { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: var(--color-text-secondary); }
.credit .credit-head .amt { font-size: .95rem; color: var(--color-text); font-variant-numeric: tabular-nums; }
.credit .bar { height: 8px; border-radius: var(--radius-full); background: var(--color-surface); overflow: hidden; }
.credit .bar > span { display: block; height: 100%; background: var(--color-primary); border-radius: var(--radius-full); transition: width .3s; }
.credit .bar > span.over { background: var(--color-error); }
.credit .credit-hint { color: var(--color-text-secondary); font-size: .82rem; margin: 8px 0 0; }
`;

export async function renderWorkspaceUsagePage(
  env: Env,
  slug: string,
  userId: string
): Promise<Response> {
  const workspace = await env.DB.prepare(
    'SELECT id, name FROM workspaces WHERE slug = ?'
  ).bind(slug).first<{ id: string; name: string }>();

  if (!workspace) {
    return new Response('Workspace not found', { status: 404 });
  }

  const role = await getInternalWorkspaceRole(env, workspace.id, userId);
  if (!role) {
    return new Response('You are not a member of this workspace', { status: 403 });
  }

  const isAdmin = role === 'owner' || role === 'admin';

  const storage = await getWorkspaceStorageLive(env, workspace.id).catch(() => null);
  const storageCard = storageHtml(storage);

  const body = `<div class="usage-page" data-workspace="${escapeHtml(workspace.id)}" data-admin="${isAdmin ? '1' : '0'}">
  <h1>Usage &amp; Billing</h1>
  <p class="sub">${escapeHtml(workspace.name)}</p>

  <div class="notice" id="notice"></div>

  ${storageCard}

  <div class="credit" id="creditCard" style="display:none">
    <div class="credit-head">
      <span class="label">Included AI credit this month</span>
      <span class="amt" id="creditAmt">—</span>
    </div>
    <div class="bar"><span id="creditBar" style="width:0%"></span></div>
    <p class="credit-hint" id="creditHint"></p>
  </div>

  <div class="cards">
    <div class="card"><div class="label">Balance</div><div class="value" id="balance">—</div></div>
    <div class="card"><div class="label">Spent this month</div><div class="value" id="monthSpend">—</div></div>
    <div class="card"><div class="label">Total requests</div><div class="value" id="totalReq">—</div></div>
    <div class="card"><div class="label">Total tokens</div><div class="value" id="totalTok">—</div></div>
  </div>

  ${isAdmin ? `
  <div class="section" id="topupSection">
    <h2>Add AI credit</h2>
    <p class="hint">Buy pay-as-you-go credit for when your monthly allowance runs out. Charges the card on file; the balance rolls over month to month and is spent only after the monthly credit is used up.</p>
    <div class="byo-status platform" id="topupBal">—</div>
    <div class="row" id="topupBtns"></div>
  </div>` : ''}

  <div class="section">
    <h2>Your AI provider key</h2>
    <p class="hint">Use your own OpenAI or Vercel AI Gateway key to run the agent on your own account — usage is recorded for visibility but never blocked. Without a key, requests draw from your platform balance.</p>
    <div class="byo-status platform" id="byoStatus">Loading…</div>
    ${isAdmin ? `
    <div class="row" id="byoForm">
      <select id="provider">
        <option value="openai">OpenAI</option>
        <option value="vercel-gateway">Vercel AI Gateway</option>
      </select>
      <input id="apiKey" type="password" placeholder="sk-… (stored encrypted)" autocomplete="off" />
      <button class="so-c-btn so-c-btn--primary" id="saveKey">Save key</button>
      <button class="so-c-btn so-c-btn--ghost" id="removeKey">Remove</button>
    </div>` : `<p class="muted">Only workspace admins can change the provider key.</p>`}
  </div>

  <div class="section">
    <h2>Usage log</h2>
    <p class="hint">Every agent request, newest first.</p>
    <table>
      <thead><tr>
        <th>When</th><th>Artifact</th><th>Mode</th><th>Model</th>
        <th class="num">In</th><th class="num">Out</th><th class="num">Cost</th><th>Source</th>
      </tr></thead>
      <tbody id="usageRows"><tr><td colspan="8" class="muted">Loading…</td></tr></tbody>
    </table>
  </div>
</div>
<script>${pageScript}</script>`;

  return renderHtmlPage({
    title: `Usage · ${escapeHtml(workspace.name)}`,
    pageStyles: usageStyles,
    body,
    cacheControl: 'no-store',
  });
}

function fmtStorageBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function storageHtml(
  s: { used: number; max: number; overage: number } | null,
): string {
  if (!s || s.max <= 0) return '';
  const pct = Math.min(100, Math.round((s.used / s.max) * 100));
  const over = s.overage > 0;
  const near = !over && pct >= 80;
  let hint: string;
  if (over) {
    hint = `${fmtStorageBytes(s.overage)} over this instance's cap — delete data, or raise STORAGE_QUOTA_BYTES.`;
  } else if (near) {
    hint = `${100 - pct}% of this instance's storage cap left.`;
  } else {
    hint = `${fmtStorageBytes(Math.max(0, s.max - s.used))} left of ${fmtStorageBytes(s.max)}.`;
  }
  const upsell = '';
  return `<div class="credit" id="storageCard">
    <div class="credit-head">
      <span class="label">Storage</span>
      <span class="amt">${fmtStorageBytes(s.used)} of ${fmtStorageBytes(s.max)}</span>
    </div>
    <div class="bar"><span style="width:${pct}%" class="${over ? 'over' : ''}"></span></div>
    <p class="credit-hint">${escapeHtml(hint)}</p>
    ${upsell}
  </div>`;
}

const pageScript = `
(function () {
  var root = document.querySelector('.usage-page');
  var wid = root.dataset.workspace;
  var isAdmin = root.dataset.admin === '1';
  var base = '/v1/workspaces/' + wid;
  var usd = function (n) { return '$' + Number(n).toFixed(4); };
  var notice = document.getElementById('notice');
  function flash(msg, ok) { notice.textContent = msg; notice.className = 'notice ' + (ok ? 'ok' : 'err'); setTimeout(function(){ notice.className='notice'; }, 4000); }

  function loadConfig() {
    return fetch(base + '/llm', { credentials: 'include' }).then(function (r) { return r.json(); }).then(function (c) {
      var bal = document.getElementById('balance');
      bal.textContent = usd(c.balanceUsd);
      bal.className = 'value' + (c.balanceUsd <= 0 ? ' low' : '');
      document.getElementById('monthSpend').textContent = usd(c.currentMonthSpendUsd);

      var card = document.getElementById('creditCard');
      card.style.display = '';
      var amt = document.getElementById('creditAmt');
      var bar = document.getElementById('creditBar');
      var hint = document.getElementById('creditHint');
      var tier = (c.aiTier || 'free').charAt(0).toUpperCase() + (c.aiTier || 'free').slice(1);
      if (c.aiCreditExempt) {
        amt.textContent = 'Unlimited';
        bar.style.width = '0%';
        hint.textContent = tier + ' plan — AI usage is not metered.';
      } else {
        var pct = c.aiCreditUsd > 0 ? Math.min(100, Math.round((c.currentMonthSpendUsd / c.aiCreditUsd) * 100)) : 100;
        amt.textContent = usd(c.currentMonthSpendUsd) + ' of ' + usd(c.aiCreditUsd);
        bar.style.width = pct + '%';
        bar.className = c.aiCreditAllowed ? '' : 'over';
        hint.textContent = c.aiCreditAllowed
          ? (usd(c.aiCreditRemainingUsd) + ' left on your ' + tier + ' plan this month.')
          : ('AI credit used up. Upgrade your plan or add your own AI key below to keep using AI.');
      }

      if (isAdmin) {
        var tbal = document.getElementById('topupBal');
        if (tbal) tbal.textContent = 'Top-up balance: ' + usd(c.topupBalanceUsd || 0);
        var btnWrap = document.getElementById('topupBtns');
        if (btnWrap && !btnWrap.dataset.built) {
          btnWrap.dataset.built = '1';
          var tiers = c.topupTiers || [{ creditUsd: 10, chargeArs: 14000 }, { creditUsd: 25, chargeArs: 35000 }, { creditUsd: 50, chargeArs: 70000 }];
          tiers.forEach(function (t) {
            var b = document.createElement('button');
            b.className = 'so-c-btn so-c-btn--primary';
            b.textContent = '$' + t.creditUsd + ' credit · ARS ' + t.chargeArs.toLocaleString();
            b.addEventListener('click', function () { buyTopup(t.creditUsd, b); });
            btnWrap.appendChild(b);
          });
        }
      }

      var st = document.getElementById('byoStatus');
      if (c.hasByoKey) {
        st.className = 'byo-status';
        st.textContent = 'Using your own ' + (c.byoProvider === 'vercel-gateway' ? 'Vercel AI Gateway' : 'OpenAI') + ' key — usage is not billed to your balance.';
      } else {
        st.className = 'byo-status platform';
        st.textContent = 'Using the platform key — usage draws from your balance (incl. ' + Math.round((c.markup - 1) * 100) + '% service fee).';
      }
    });
  }

  function loadUsage() {
    return fetch(base + '/usage?limit=50', { credentials: 'include' }).then(function (r) { return r.json(); }).then(function (d) {
      document.getElementById('totalReq').textContent = d.totals.requests;
      document.getElementById('totalTok').textContent = (d.totals.inputTokens + d.totals.outputTokens).toLocaleString();
      var tb = document.getElementById('usageRows');
      if (!d.events.length) { tb.innerHTML = '<tr><td colspan="8" class="muted">No usage yet.</td></tr>'; return; }
      tb.innerHTML = d.events.map(function (e) {
        return '<tr>' +
          '<td>' + new Date(e.createdAt + 'Z').toLocaleString() + '</td>' +
          '<td>' + (e.artifactName || e.artifactId) + '</td>' +
          '<td>' + e.mode + '</td>' +
          '<td>' + e.model + '</td>' +
          '<td class="num">' + e.inputTokens + '</td>' +
          '<td class="num">' + e.outputTokens + '</td>' +
          '<td class="num">' + usd(e.billedCostUsd) + '</td>' +
          '<td>' + (e.byo ? '<span class="tag byo">own key</span>' : '<span class="tag">platform</span>') + '</td>' +
        '</tr>';
      }).join('');
    });
  }

  function buyTopup(amount, btn) {
    btn.disabled = true;
    fetch(base + '/llm/topup', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountUsd: amount }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (res.ok && res.j.status === 'approved') { flash('Added $' + amount + ' AI credit', true); loadConfig(); }
        else if (res.ok && res.j.status === 'pending') { flash('Payment processing — credit will appear shortly.', true); }
        else { flash(res.j.error || 'Top-up failed', false); }
      })
      .catch(function () { btn.disabled = false; flash('Top-up failed', false); });
  }

  if (isAdmin) {
    document.getElementById('saveKey').addEventListener('click', function () {
      var provider = document.getElementById('provider').value;
      var apiKey = document.getElementById('apiKey').value.trim();
      if (!apiKey) { flash('Enter an API key', false); return; }
      fetch(base + '/llm', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: provider, apiKey: apiKey }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) { if (res.ok) { document.getElementById('apiKey').value = ''; flash('Key saved', true); loadConfig(); } else { flash(res.j.error || 'Failed', false); } });
    });
    document.getElementById('removeKey').addEventListener('click', function () {
      fetch(base + '/llm', { method: 'DELETE', credentials: 'include' })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) { if (res.ok) { flash('Key removed', true); loadConfig(); } else { flash(res.j.error || 'Failed', false); } });
    });
  }

  loadConfig().catch(function () { flash('Failed to load config', false); });
  loadUsage().catch(function () {});
})();
`;
