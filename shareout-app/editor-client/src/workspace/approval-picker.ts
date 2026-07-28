import { escapeHtml } from '../utils';
import { showToast } from '../toast';

interface Member { user_id: string; email: string | null; name: string | null }

interface PickerOptions {
  artifactId: string;
  workspaceId: string;
  visibility: string;
  required: number;
  selfUserId?: string;
}

function label(m: Member): string {
  return (m.name || m.email || '').trim() || (m.email || '');
}

/**
 * Compact approver picker for the editor's visibility control. When the workspace
 * holds a public/unlisted change for approval, the requester nominates exactly N
 * teammates here; submitting POSTs the publish-approval request.
 */
export function openEditorApproverPicker(opts: PickerOptions): void {
  const required = Math.max(1, opts.required || 1);
  const selected: Member[] = [];
  let members: Member[] = [];

  const existing = document.getElementById('editor-appr-overlay');
  if (existing) existing.remove();

  const ov = document.createElement('div');
  ov.id = 'editor-appr-overlay';
  ov.innerHTML = `<div class="editor-appr-dialog" role="dialog" aria-labelledby="editor-appr-title">
    <h3 id="editor-appr-title">Request publish approval</h3>
    <p>Your workspace requires approval to publish ${escapeHtml(opts.visibility)}. Pick exactly ${required} teammate${required === 1 ? '' : 's'} to approve. The page stays workspace-visible until they do.</p>
    <div id="editor-appr-chips" class="editor-appr-chips"></div>
    <input id="editor-appr-input" class="so-c-input editor-appr-input" type="text" placeholder="Search teammates…" autocomplete="off">
    <div id="editor-appr-suggest" class="editor-appr-suggest"></div>
    <div class="editor-appr-actions">
      <button id="editor-appr-submit" type="button" class="so-c-btn so-c-btn--primary" disabled>Send for approval</button>
      <button id="editor-appr-cancel" type="button" class="so-c-btn so-c-btn--secondary">Cancel</button>
      <span id="editor-appr-msg" class="editor-appr-msg"></span>
    </div>
  </div>`;
  document.body.appendChild(ov);

  const input = ov.querySelector<HTMLInputElement>('#editor-appr-input')!;
  const suggest = ov.querySelector<HTMLDivElement>('#editor-appr-suggest')!;
  const chips = ov.querySelector<HTMLDivElement>('#editor-appr-chips')!;
  const submit = ov.querySelector<HTMLButtonElement>('#editor-appr-submit')!;
  const msg = ov.querySelector<HTMLSpanElement>('#editor-appr-msg')!;

  function close(): void { ov.remove(); }
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('#editor-appr-cancel')!.addEventListener('click', close);

  function renderChips(): void {
    chips.innerHTML = selected.length
      ? selected.map((m, i) => `<span class="editor-appr-chip">${escapeHtml(label(m))}<button type="button" class="editor-appr-chip-rm" data-rm="${i}" aria-label="Remove">×</button></span>`).join('')
      : '<span class="editor-appr-empty">No one selected yet</span>';
    chips.querySelectorAll<HTMLButtonElement>('[data-rm]').forEach((b) => {
      b.addEventListener('click', () => { selected.splice(Number(b.dataset.rm), 1); renderChips(); renderSuggest(input.value); });
    });
    submit.disabled = selected.length !== required;
    msg.textContent = `${selected.length}/${required} selected`;
  }

  function renderSuggest(query: string): void {
    const q = (query || '').trim().toLowerCase();
    const chosen = new Set(selected.map((s) => s.user_id));
    const matches = members.filter((m) => {
      if (chosen.has(m.user_id)) return false;
      const lbl = label(m).toLowerCase();
      const em = (m.email || '').toLowerCase();
      return !q || lbl.indexOf(q) >= 0 || em.indexOf(q) >= 0;
    }).slice(0, 8);
    suggest.innerHTML = matches.map((m) => {
      const sub = m.email && m.email !== label(m) ? m.email : '';
      return `<button type="button" class="editor-appr-suggest-item" data-uid="${escapeHtml(m.user_id)}">${escapeHtml(label(m))}${sub ? `<span class="editor-appr-suggest-sub"> · ${escapeHtml(sub)}</span>` : ''}</button>`;
    }).join('');
    suggest.querySelectorAll<HTMLButtonElement>('[data-uid]').forEach((b) => {
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const m = members.find((x) => x.user_id === b.dataset.uid);
        if (!m) return;
        if (selected.length >= required) selected.pop();
        selected.push(m);
        input.value = '';
        renderChips();
        renderSuggest('');
        input.focus();
      });
    });
  }

  input.addEventListener('input', () => renderSuggest(input.value));
  input.addEventListener('focus', () => renderSuggest(input.value));

  submit.addEventListener('click', async () => {
    if (selected.length !== required) return;
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const res = await fetch(`/v1/artifacts/${opts.artifactId}/publish-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ visibility: opts.visibility, approver_ids: selected.map((m) => m.user_id) }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.ok) {
        close();
        showToast(`Sent for approval — stays workspace-visible until ${required} approve`, 'success');
      } else {
        submit.disabled = false;
        submit.textContent = 'Send for approval';
        msg.textContent = (data && data.error) || 'Failed to send.';
      }
    } catch {
      submit.disabled = false;
      submit.textContent = 'Send for approval';
      msg.textContent = 'Network error.';
    }
  });

  renderChips();
  input.focus();

  fetch(`/v1/workspaces/${encodeURIComponent(opts.workspaceId)}/members`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : { members: [] }))
    .then((d: { members?: Member[] }) => {
      members = (d.members || []).filter((m) => m.user_id && m.user_id !== opts.selfUserId);
      renderSuggest(input.value);
    })
    .catch(() => {});
}
