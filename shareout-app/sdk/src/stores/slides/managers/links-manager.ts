import type { SdkClient } from '../../../core/sdk-client';
import type { CreateLinkOptions, LinkAccessResult, ShareLink } from '../types';

/**
 * Tracked & gated share links (Slides B2B P1). Owner methods mint/list/revoke
 * links; `gate()` and `access()` are the public viewer side that name an
 * otherwise-anonymous analytics session.
 */
export class LinksManager {
  constructor(
    private sdk: SdkClient,
    private presId: string,
  ) {}

  private base(): string {
    return `/slides/${encodeURIComponent(this.presId)}/links`;
  }

  /** Owner: mint a tracked link for a named recipient, optionally gated. */
  async create(options: CreateLinkOptions = {}): Promise<ShareLink> {
    return this.sdk._internalFetch<ShareLink>(this.base(), {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  /** Owner: list links for this deck with live view counts. */
  async list(): Promise<ShareLink[]> {
    const res = await this.sdk._internalFetch<{ links: ShareLink[] }>(this.base());
    return res.links;
  }

  /** Owner: revoke a link (existing sessions keep their analytics). */
  async revoke(linkId: string): Promise<void> {
    await this.sdk._internalFetch(`${this.base()}/${encodeURIComponent(linkId)}`, { method: 'DELETE' });
  }

  /** Public: what the gate requires, so the viewer can prompt before rendering. */
  async gate(linkId: string): Promise<{ gate: string; recipientLabel: string | null; revoked: boolean; expired: boolean }> {
    return this.sdk._internalFetch(`${this.base()}/${encodeURIComponent(linkId)}`);
  }

  /** Public: pass the gate (email/password as required) → attributed sessionId. */
  async access(linkId: string, credentials: { email?: string; password?: string } = {}): Promise<LinkAccessResult> {
    return this.sdk._internalFetch<LinkAccessResult>(
      `${this.base()}/${encodeURIComponent(linkId)}/access`,
      { method: 'POST', body: JSON.stringify(credentials) },
    );
  }
}
