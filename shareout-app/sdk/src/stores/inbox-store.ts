import type { SdkClient } from '../core/sdk-client';

export interface InboxAttachment {
  filename: string;
  contentType: string;
  size: number;
  index: number;
}

export interface InboxMessage {
  id: string;
  rfcMessageId: string | null;
  from: string;
  to: string;
  tag: string | null;
  subject: string | null;
  /** Present on list responses. */
  textPreview?: string;
  hasHtml?: boolean;
  /** Present on get (single message) responses. */
  text?: string | null;
  html?: string | null;
  auth: { spf: string | null; dkim: string | null; dmarc: string | null };
  attachments: InboxAttachment[];
  sizeBytes: number;
  receivedAt: number;
}

export interface InboxStatus {
  enabled: boolean;
  /** The receiving address (e.g. expensas@inbox.shareout.site), or null when disabled. */
  address: string | null;
  allowlist: string[] | null;
  receivedToday: number;
}

export interface InboxListOptions {
  limit?: number;
  /** Unix seconds; return messages received before this (cursor for paging). */
  before?: number;
}

/**
 * Read-side access to the artifact's inbound email inbox. Messages arrive via
 * Cloudflare Email Routing and fire `email.received` triggers server-side; this
 * store lets the artifact UI show what came in. Backed by the per-artifact store
 * (no realtime socket), so `onMessage` polls.
 */
export class InboxStore {
  constructor(private sdk: SdkClient) {}

  /** Inbox status: whether receiving is on, the address, allowlist, today's count. */
  async status(): Promise<InboxStatus> {
    return this.sdk._internalFetch<InboxStatus>('/inbox/status');
  }

  /** Turn receiving on (owner/editor). Optionally set an allowed-sender allowlist. */
  async enable(opts?: { allowlist?: string[] }): Promise<InboxStatus> {
    return this.sdk._internalFetch<InboxStatus>('/inbox/enable', {
      method: 'POST',
      body: JSON.stringify(opts || {}),
    });
  }

  /** Turn receiving off (owner/editor). */
  async disable(): Promise<{ enabled: boolean }> {
    return this.sdk._internalFetch<{ enabled: boolean }>('/inbox/disable', { method: 'POST' });
  }

  /** Replace the allowed-sender allowlist (addresses or @domains). null = allow any. */
  async setAllowlist(allowlist: string[] | null): Promise<InboxStatus> {
    return this.sdk._internalFetch<InboxStatus>('/inbox/allowlist', {
      method: 'PUT',
      body: JSON.stringify({ allowlist }),
    });
  }

  /** List received messages, newest first. */
  async list(opts: InboxListOptions = {}): Promise<InboxMessage[]> {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.before) params.set('before', String(opts.before));
    const qs = params.toString();
    const res = await this.sdk._internalFetch<{ messages: InboxMessage[] }>(`/inbox/messages${qs ? `?${qs}` : ''}`);
    return res.messages;
  }

  /** Fetch one message with full text/html bodies. */
  async get(id: string): Promise<InboxMessage> {
    return this.sdk._internalFetch<InboxMessage>(`/inbox/messages/${encodeURIComponent(id)}`);
  }

  /** URL to download an attachment by message id + attachment index. */
  attachmentUrl(messageId: string, index: number): string {
    return `${this.sdk._baseUrl}/v1/data/${this.sdk._artifactId}/inbox/messages/${encodeURIComponent(messageId)}/attachments/${index}`;
  }

  /**
   * Poll for new messages and invoke `cb` for each one not seen before. Returns an
   * unsubscribe function. Polling (not push) because the inbox has no realtime socket.
   */
  onMessage(cb: (message: InboxMessage) => void, opts: { intervalMs?: number } = {}): () => void {
    const intervalMs = Math.max(opts.intervalMs ?? 15000, 3000);
    const seen = new Set<string>();
    let stopped = false;
    let primed = false;

    const tick = async () => {
      if (stopped) return;
      try {
        const messages = await this.list({ limit: 50 });
        // First pass primes `seen` without firing, so we only surface mail that
        // arrives after subscription.
        for (const m of messages) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            if (primed) cb(m);
          }
        }
        primed = true;
      } catch { /* transient errors are retried on the next tick */ }
    };

    void tick();
    const handle = setInterval(tick, intervalMs);
    return () => { stopped = true; clearInterval(handle); };
  }
}
