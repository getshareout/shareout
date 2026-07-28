/**
 * In-browser admin portal script: modals, mutations, live search, SPA navigation.
 *
 * Injected once per full page load; re-binds per-view handlers after fragment swaps.
 */

import { GLOBAL_TARGET } from '../../features/flags';

export function pageScript(initView: string, initRange: string): string {
  return `
let curView = ${JSON.stringify(initView)};
let curRange = ${JSON.stringify(initRange)};

const modal = document.getElementById('sa-modal-bg');
const confirmBtn = document.getElementById('sa-modal-confirm');
const cancelBtn = document.getElementById('sa-modal-cancel');
let onConfirm = null;
function openModal(title, body, confirmLabel, cb) {
  document.getElementById('sa-modal-title').textContent = title;
  document.getElementById('sa-modal-body').innerHTML = body;
  onConfirm = cb;
  if (cb) { confirmBtn.style.display = ''; confirmBtn.textContent = confirmLabel; cancelBtn.textContent = 'Cancel'; }
  else { confirmBtn.style.display = 'none'; cancelBtn.textContent = 'Close'; }
  modal.classList.add('open');
}
function closeModal() { modal.classList.remove('open'); onConfirm = null; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
cancelBtn.onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };
confirmBtn.onclick = () => { if (onConfirm) onConfirm(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) closeModal(); });

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || ('Request failed (' + res.status + ')')); }
  return res.json();
}

window.saView = async (id) => {
  try {
    const u = await api('GET', '/v1/admin/users/' + id);
    const arts = (u.artifacts || []).slice(0, 30).map((a) =>
      '<tr><td><a href="/a/' + esc(a.slug) + '/" style="color:var(--color-primary)">' + esc(a.name || a.slug) + '</a></td><td class="sa-muted">' + esc(a.type) + '</td><td class="sa-muted">' + esc(a.visibility) + '</td></tr>'
    ).join('') || '<tr><td colspan="3" class="sa-muted">None</td></tr>';
    const wks = (u.workspaces || []).map((w) => esc(w.name)).join(', ') || '<span class="sa-muted">None</span>';
    openModal('User · ' + esc(u.email || u.id),
      '<p><strong>Tier:</strong> ' + esc(u.tier) + (u.inTeamWorkspace && u.tier !== 'team' && u.tier !== 'enterprise' ? ' <span class="so-c-badge so-c-badge--primary">Team · via workspace</span>' : '') + (u.disabled ? ' · <span style="color:var(--color-error)">disabled</span>' : '') + '<br>' +
      '<strong>Joined:</strong> ' + esc((u.createdAt || '').slice(0, 10)) + ' · <strong>Last login:</strong> ' + esc((u.lastLoginAt || '—').slice(0, 10)) + '<br>' +
      '<strong>API tokens:</strong> ' + u.tokenCount + ' · <strong>LLM:</strong> ' + (u.totalTokens || 0).toLocaleString() + ' tokens / $' + (u.costUsd || 0).toFixed(2) + '</p>' +
      '<p style="margin-top:12px"><strong>Workspaces:</strong> ' + wks + '</p>' +
      '<p style="margin-top:12px"><strong>Artifacts (' + (u.artifacts || []).length + '):</strong></p>' +
      '<table class="sa-table"><thead><tr><th>Name</th><th>Type</th><th>Visibility</th></tr></thead><tbody>' + arts + '</tbody></table>',
      null, null);
  } catch (e) { alert(e.message); }
};

window.saTier = (id, tier) => api('POST', '/v1/admin/users/' + id + '/tier', { tier }).catch((e) => alert(e.message));
window.saRevoke = (id, disabled) => api('POST', '/v1/admin/users/' + id + '/revoke', { disabled: !!disabled }).then(refresh).catch((e) => alert(e.message));
window.saDelete = (id, label) => {
  openModal('Delete user',
    '<p>Permanently delete <strong>' + esc(label) + '</strong> and all their artifacts and workspaces? This cannot be undone.</p><p style="margin-top:12px">Type <code>DELETE</code> to confirm:</p><input id="sa-confirm-input" class="so-c-input" autocomplete="off" style="margin-top:8px">',
    'Delete user',
    async () => {
      if (document.getElementById('sa-confirm-input').value !== 'DELETE') { alert('Type DELETE to confirm.'); return; }
      try { await api('DELETE', '/v1/admin/users/' + id); closeModal(); refresh(); } catch (e) { alert(e.message); }
    });
};

window.saModerate = (id, action) => api('POST', '/v1/admin/artifacts/' + id + '/moderation', { action }).then(refresh).catch((e) => alert(e.message));
window.saPause = (id, paused) => api('POST', '/v1/admin/artifacts/' + id + '/pause', { paused: !!paused }).then(refresh).catch((e) => alert(e.message));
window.saVisibility = (id, visibility) => api('POST', '/v1/admin/artifacts/' + id + '/visibility', { visibility }).catch((e) => alert(e.message));
window.saDeleteArtifact = (id, label) => {
  openModal('Delete artifact',
    '<p>Permanently delete <strong>' + esc(label) + '</strong>? This removes all versions and files. This cannot be undone.</p><p style="margin-top:12px">Type <code>DELETE</code> to confirm:</p><input id="sa-confirm-input" class="so-c-input" autocomplete="off" style="margin-top:8px">',
    'Delete artifact',
    async () => {
      if (document.getElementById('sa-confirm-input').value !== 'DELETE') { alert('Type DELETE to confirm.'); return; }
      try { await api('DELETE', '/v1/admin/artifacts/' + id); closeModal(); refresh(); } catch (e) { alert(e.message); }
    });
};

function liveSearch(inputId, bodyId, countId, endpoint, noun) {
  const input = document.getElementById(inputId);
  if (!input) return;
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const data = await api('GET', endpoint + '?search=' + encodeURIComponent(input.value.trim()));
        document.getElementById(bodyId).innerHTML = data.rows;
        document.getElementById(countId).textContent = data.total.toLocaleString() + ' ' + noun;
      } catch (e) { /* ignore */ }
    }, 250);
  });
}
// (Re)bind per-view behavior after the content region is swapped.
function initContent() {
  liveSearch('sa-user-search', 'sa-users', 'sa-user-count', '/v1/admin/users', 'users');
  liveSearch('sa-art-search', 'sa-artifacts', 'sa-art-count', '/v1/admin/artifacts', 'artifacts');
  initFeatures();
  initInstance();
}

// ---- Instance view: provision a workspace, appoint a role ----
let appointWs = null;

function initInstance() {
  const createBtn = document.getElementById('sa-ws-create');
  if (createBtn) createBtn.onclick = async () => {
    const name = document.getElementById('sa-ws-name').value.trim();
    const owner = document.getElementById('sa-ws-owner').value.trim();
    const slug = document.getElementById('sa-ws-slug').value.trim();
    const out = document.getElementById('sa-ws-result');
    if (!name || !owner) { out.textContent = 'Name and owner email are both required.'; return; }
    createBtn.disabled = true; out.textContent = 'Creating…';
    try {
      const w = await api('POST', '/v1/admin/workspaces', slug ? { name, owner_email: owner, slug } : { name, owner_email: owner });
      const at = w.slug ? ' at /@' + esc(w.slug) : '';
      out.innerHTML = 'Created <strong>' + esc(w.name || name) + '</strong>' + at + ', owned by ' + esc(owner) + '.';
      document.getElementById('sa-ws-name').value = '';
      document.getElementById('sa-ws-owner').value = '';
      document.getElementById('sa-ws-slug').value = '';
    } catch (e) { out.textContent = e.message; }
    createBtn.disabled = false;
  };

  const search = document.getElementById('sa-appoint-search');
  if (search) {
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = search.value.trim();
        const box = document.getElementById('sa-appoint-results');
        try {
          const data = await api('GET', '/v1/admin/workspaces?search=' + encodeURIComponent(q));
          box.innerHTML = (data.workspaces || []).map((w) =>
            '<button class="sa-feat-result" onclick="saAppointTarget(' + JSON.stringify(w.id) + ',' + JSON.stringify(w.name) + ')">' +
            esc(w.name) + ' <span class="sa-muted">/' + esc(w.slug) + '</span></button>'
          ).join('') || '<div class="sa-muted" style="padding:8px">No workspaces.</div>';
        } catch (e) { /* ignore */ }
      }, 250);
    });
  }

  const appointBtn = document.getElementById('sa-appoint-btn');
  if (appointBtn) appointBtn.onclick = async () => {
    const email = document.getElementById('sa-appoint-email').value.trim();
    const role = document.getElementById('sa-appoint-role').value;
    const out = document.getElementById('sa-appoint-result');
    if (!appointWs) { out.textContent = 'Pick a workspace first.'; return; }
    if (!email) { out.textContent = 'Email is required.'; return; }
    appointBtn.disabled = true; out.textContent = 'Saving…';
    try {
      await api('POST', '/v1/admin/workspaces/' + encodeURIComponent(appointWs) + '/members', { email, role });
      out.innerHTML = esc(email) + ' is now <strong>' + esc(role) + '</strong>.';
      document.getElementById('sa-appoint-email').value = '';
    } catch (e) { out.textContent = e.message; }
    appointBtn.disabled = false;
  };
}

window.saAppointTarget = (id, label) => {
  appointWs = id;
  const cur = document.getElementById('sa-appoint-current');
  if (cur) cur.innerHTML = 'Workspace: <strong>' + esc(label) + '</strong>';
  const res = document.getElementById('sa-appoint-results');
  if (res) res.innerHTML = '';
  const btn = document.getElementById('sa-appoint-btn');
  if (btn) btn.disabled = false;
};

// ---- Features view ----
let featTarget = ${JSON.stringify(GLOBAL_TARGET)};

function initFeatures() {
  const input = document.getElementById('sa-feat-search');
  if (!input) return;
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      try {
        const data = await api('GET', '/v1/admin/workspaces?search=' + encodeURIComponent(q));
        const box = document.getElementById('sa-feat-results');
        box.innerHTML = (data.workspaces || []).map((w) =>
          '<button class="sa-feat-result" onclick="saFeatTarget(' + JSON.stringify(w.id) + ',' + JSON.stringify(w.name) + ')">' +
          esc(w.name) + ' <span class="sa-muted">/' + esc(w.slug) + (w.overrideCount ? ' · ' + w.overrideCount + ' override' + (w.overrideCount === 1 ? '' : 's') : '') + '</span></button>'
        ).join('') || '<div class="sa-muted" style="padding:8px">No workspaces.</div>';
      } catch (e) { /* ignore */ }
    }, 250);
  });
}

window.saFeatTarget = async (target, label) => {
  featTarget = target;
  document.querySelectorAll('.sa-feat-tab').forEach((b) => b.classList.toggle('active', target === ${JSON.stringify(GLOBAL_TARGET)}));
  const cur = document.getElementById('sa-feat-current');
  if (cur) cur.innerHTML = 'Editing: <strong>' + esc(label) + '</strong>';
  const res = document.getElementById('sa-feat-results');
  if (res) res.innerHTML = '';
  try {
    const data = await api('GET', '/v1/admin/features?target=' + encodeURIComponent(target));
    document.getElementById('sa-feat-grid').outerHTML = data.html;
  } catch (e) { alert(e.message); }
};

window.saFeature = async (target, key, value) => {
  try {
    const data = await api('POST', '/v1/admin/features', { target, key, value });
    document.getElementById('sa-feat-grid').outerHTML = data.html;
  } catch (e) { alert(e.message); }
};

// ---- Client-side navigation: fetch view fragments, cache, prefetch on hover ----
const viewCache = new Map();
const key = (v, r) => v + '|' + r;

function fetchView(v, r) {
  const k = key(v, r);
  if (viewCache.has(k)) return viewCache.get(k);
  const p = api('GET', '/v1/admin/view?view=' + encodeURIComponent(v) + '&range=' + encodeURIComponent(r))
    .catch((e) => { viewCache.delete(k); throw e; });
  viewCache.set(k, p); // cache the promise so concurrent hover+click dedupe
  return p;
}

function setActiveNav(v) {
  document.querySelectorAll('.sa-nav-item').forEach((a) => {
    const u = new URL(a.href);
    a.classList.toggle('active', u.searchParams.get('view') === v);
  });
}

const content = document.getElementById('sa-content');
async function navigate(v, r, push) {
  curView = v; curRange = r;
  setActiveNav(v);
  content.classList.add('sa-loading');
  let data;
  try {
    data = await fetchView(v, r);
  } catch (e) {
    location.href = '?view=' + v + '&range=' + r; // hard fallback
    return;
  }
  document.getElementById('sa-title').textContent = data.title;
  document.getElementById('sa-rangebar').innerHTML = data.rangeBar;
  content.innerHTML = data.html;
  content.classList.remove('sa-loading');
  initContent();
  window.scrollTo(0, 0);
  if (push) history.pushState({ v, r }, '', '?view=' + v + '&range=' + r);
}

// Re-fetch the current view fresh (used after a mutation).
function refresh() {
  viewCache.delete(key(curView, curRange));
  return navigate(curView, curRange, false);
}

// Intercept sidebar + range clicks.
document.addEventListener('click', (e) => {
  const navItem = e.target.closest('.sa-nav-item');
  if (navItem) { e.preventDefault(); const u = new URL(navItem.href); navigate(u.searchParams.get('view'), curRange, true); return; }
  const rangeBtn = e.target.closest('.sa-range-btn');
  if (rangeBtn) { e.preventDefault(); const u = new URL(rangeBtn.href); navigate(curView, u.searchParams.get('range'), true); return; }
});

// Prefetch on hover so the click is instant.
document.addEventListener('mouseover', (e) => {
  const navItem = e.target.closest('.sa-nav-item');
  if (navItem) { const u = new URL(navItem.href); fetchView(u.searchParams.get('view'), curRange).catch(() => {}); }
});

window.addEventListener('popstate', (e) => {
  const s = e.state || {};
  const url = new URL(location.href);
  navigate(s.v || url.searchParams.get('view') || 'overview', s.r || url.searchParams.get('range') || '30', false);
});

history.replaceState({ v: curView, r: curRange }, '', location.href);
initContent();

`;
}
