// "Inbox" rail panel — the editor's window into an artifact's inbound email inbox.
// Shows the receiving address (when enabled), enable/disable + allowlist controls,
// and the received messages with an inline detail view. All via the existing
// /v1/data/{artifactId}/inbox/* API (session-cookie auth, no new backend).
import type { EditorContext } from '../editor/context';
import { escapeHtml } from '../utils';
import { showToast } from '../toast';
import { showConfirmDialog } from '../ui/confirm-dialog';

export interface InboxStatus {
  enabled: boolean;
  address: string | null;
  allowlist: string[] | null;
  receivedToday: number;
}

export interface InboxMessage {
  id: string;
  from: string;
  subject: string | null;
  textPreview?: string;
  text?: string | null;
  html?: string | null;
  attachments: { filename: string; contentType: string; size: number; index: number }[];
  receivedAt: number;
}

function fmtDate(unixSeconds: number): string {
  try {
    return new Date(unixSeconds * 1000).toLocaleString();
  } catch {
    return '';
  }
}

export async function renderInboxPanel(ctx: EditorContext, host: HTMLElement): Promise<void> {
  host.innerHTML = '<div class="rail-empty"><p class="rail-empty-hint">Loading inbox…</p></div>';
  try {
    const res = await fetch(`/v1/data/${ctx.config.artifactId}/inbox/status`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    // The data API wraps responses in { success, data }.
    const status = ((await res.json()) as { data?: InboxStatus }).data
      ?? { enabled: false, address: null, allowlist: null, receivedToday: 0 };
    host.innerHTML = inboxPanelMarkup(status);
    wireInboxPanel(ctx, host);
    if (status.enabled) void loadMessages(ctx, host);
  } catch {
    host.innerHTML = '<div class="rail-empty"><p class="rail-empty-hint">Couldn’t load the inbox.</p></div>';
  }
}

function inboxPanelMarkup(status: InboxStatus): string {
  if (!status.enabled) {
    return `
      <div class="rail-form">
        <div class="rail-empty">
          <p class="rail-empty-title">Inbox is off</p>
          <p class="rail-empty-hint">Enable it to give this page an email address. Mail sent there is stored here and can fire triggers.</p>
        </div>
        <button class="so-c-btn so-c-btn--primary so-c-btn--sm" data-inbox-enable>Enable inbox</button>
      </div>`;
  }
  const allowlist = (status.allowlist || []).join('\n');
  return `
    <div class="rail-form">
      <div class="rail-field">
        <label class="rail-label">Inbox address</label>
        <div class="rail-link-row">
          <input class="rail-input" id="inbox-address" type="text" readonly value="${escapeHtml(status.address || '')}">
          <button class="so-c-btn so-c-btn--ghost so-c-btn--sm" data-inbox-copy>Copy</button>
        </div>
        <p class="rail-empty-hint">Forward mail here, or give this address out. Add a tag with “+”, e.g. <code>${escapeHtml(tagExample(status.address))}</code>.</p>
      </div>
      <div class="rail-field">
        <label class="rail-label" for="inbox-allowlist">Allowed senders (one per line; blank = anyone)</label>
        <textarea class="rail-input" id="inbox-allowlist" rows="3" placeholder="@trusted.com&#10;biller@edificio.com" autocomplete="off">${escapeHtml(allowlist)}</textarea>
        <button class="so-c-btn so-c-btn--ghost so-c-btn--sm" data-inbox-allowlist-save>Save allowlist</button>
      </div>
      <div class="rail-field">
        <label class="rail-label">Received${status.receivedToday ? ` · ${status.receivedToday} today` : ''}</label>
        <div id="inbox-messages"><p class="rail-empty-hint">Loading messages…</p></div>
      </div>
      <button class="so-c-btn so-c-btn--ghost so-c-btn--sm" data-inbox-disable>Disable inbox</button>
    </div>`;
}

function tagExample(address: string | null): string {
  if (!address) return 'name+tag@inbox.shareout.site';
  const [local, domain] = address.split('@');
  return `${local}+tag@${domain}`;
}

function messagesMarkup(messages: InboxMessage[]): string {
  if (!messages.length) {
    return '<p class="rail-empty-hint">No messages yet. Send mail to the address above to test.</p>';
  }
  return `<div class="connect-list">${messages
    .map(
      (m) => `
      <div class="connect-item inbox-msg" data-inbox-msg="${escapeHtml(m.id)}" role="button" tabindex="0">
        <div class="connect-item-info">
          <span class="connect-item-name">${escapeHtml(m.subject || '(no subject)')}</span>
          <span class="connect-item-type">${escapeHtml(m.from)} · ${escapeHtml(fmtDate(m.receivedAt))}</span>
        </div>
        ${m.attachments?.length ? `<span class="connect-item-scope">${m.attachments.length} 📎</span>` : ''}
      </div>
      <div class="inbox-msg-detail" data-inbox-detail="${escapeHtml(m.id)}" hidden></div>`,
    )
    .join('')}</div>`;
}

function detailMarkup(ctx: EditorContext, m: InboxMessage): string {
  const body = m.text ? `<pre class="inbox-msg-body">${escapeHtml(m.text)}</pre>` : '<p class="rail-empty-hint">(no text body)</p>';
  const atts = (m.attachments || [])
    .map(
      (a) =>
        `<a class="rail-link" href="/v1/data/${ctx.config.artifactId}/inbox/messages/${encodeURIComponent(m.id)}/attachments/${a.index}" target="_blank" rel="noopener">📎 ${escapeHtml(a.filename)}</a>`,
    )
    .join('');
  return `${body}${atts ? `<div class="inbox-msg-atts">${atts}</div>` : ''}`;
}

async function loadMessages(ctx: EditorContext, host: HTMLElement): Promise<void> {
  const box = host.querySelector<HTMLElement>('#inbox-messages');
  if (!box) return;
  try {
    const res = await fetch(`/v1/data/${ctx.config.artifactId}/inbox/messages?limit=25`, { credentials: 'same-origin' });
    const data = ((await res.json()) as { data?: { messages?: InboxMessage[] } }).data;
    box.innerHTML = messagesMarkup(data?.messages || []);
    wireMessageRows(ctx, host);
  } catch {
    box.innerHTML = '<p class="rail-empty-hint">Couldn’t load messages.</p>';
  }
}

function wireMessageRows(ctx: EditorContext, host: HTMLElement): void {
  host.querySelectorAll<HTMLElement>('[data-inbox-msg]').forEach((row) => {
    const open = async () => {
      const id = row.dataset.inboxMsg!;
      const detail = host.querySelector<HTMLElement>(`[data-inbox-detail="${CSS.escape(id)}"]`);
      if (!detail) return;
      if (!detail.hidden) {
        detail.hidden = true;
        return;
      }
      detail.hidden = false;
      if (detail.dataset.loaded) return;
      detail.innerHTML = '<p class="rail-empty-hint">Loading…</p>';
      try {
        const res = await fetch(`/v1/data/${ctx.config.artifactId}/inbox/messages/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
        const m = ((await res.json()) as { data?: InboxMessage }).data;
        detail.innerHTML = m ? detailMarkup(ctx, m) : '<p class="rail-empty-hint">Couldn’t load message.</p>';
        detail.dataset.loaded = '1';
      } catch {
        detail.innerHTML = '<p class="rail-empty-hint">Couldn’t load message.</p>';
      }
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') open();
    });
  });
}

function wireInboxPanel(ctx: EditorContext, host: HTMLElement): void {
  host.querySelector<HTMLButtonElement>('[data-inbox-enable]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    if (await mutate(ctx, 'enable')) {
      showToast('Inbox enabled', 'success');
      await renderInboxPanel(ctx, host);
    } else {
      btn.disabled = false;
    }
  });

  host.querySelector<HTMLButtonElement>('[data-inbox-disable]')?.addEventListener('click', async (e) => {
    const ok = await showConfirmDialog({
      title: 'Disable the inbox?',
      body: 'New mail will be rejected. Messages already stored are kept.',
      confirmLabel: 'Disable inbox',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    if (await mutate(ctx, 'disable')) {
      showToast('Inbox disabled', 'success');
      await renderInboxPanel(ctx, host);
    } else {
      btn.disabled = false;
    }
  });

  host.querySelector<HTMLButtonElement>('[data-inbox-copy]')?.addEventListener('click', () => {
    const input = host.querySelector<HTMLInputElement>('#inbox-address');
    if (input) navigator.clipboard?.writeText(input.value);
    showToast('Address copied!', 'success');
  });

  host.querySelector<HTMLButtonElement>('[data-inbox-allowlist-save]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const raw = host.querySelector<HTMLTextAreaElement>('#inbox-allowlist')?.value || '';
    const allowlist = raw.split(/[\n,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    btn.disabled = true;
    try {
      const res = await fetch(`/v1/data/${ctx.config.artifactId}/inbox/allowlist`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ allowlist: allowlist.length ? allowlist : null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      showToast('Allowlist saved', 'success');
    } catch {
      showToast('Couldn’t save allowlist', 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

async function mutate(ctx: EditorContext, action: 'enable' | 'disable'): Promise<boolean> {
  try {
    const res = await fetch(`/v1/data/${ctx.config.artifactId}/inbox/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: '{}',
    });
    return res.ok;
  } catch {
    return false;
  }
}
