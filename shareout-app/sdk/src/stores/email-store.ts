import type { SdkClient } from '../core/sdk-client';

export interface EmailNotifyOwnerParams {
  subject?: string;
  text?: string;
  html?: string;
  replyTo?: string;
  includeArtifactLink?: boolean;
}

export interface EmailSendReportParams {
  to: string;
  subject?: string;
  text?: string;
  html?: string;
  includeArtifactLink?: boolean;
}

export interface EmailSendResult {
  sent: boolean;
  messageId?: string;
  to: string;
}

export interface EmailStatus {
  enabled: boolean;
  from?: string;
  ownerEmailConfigured: boolean;
}

export class EmailStore {
  constructor(private sdk: SdkClient) {}

  /** Whether outbound email is available and the owner can receive contact mail */
  async status(): Promise<EmailStatus> {
    return this.sdk._internalFetch<EmailStatus>('/email/status');
  }

  /**
   * Send a message to the artifact owner (contact form pattern).
   * Rate-limited; only delivers to the owner email on file.
   */
  async notifyOwner(params: EmailNotifyOwnerParams): Promise<EmailSendResult> {
    return this.sdk._internalFetch<EmailSendResult>('/email/notify-owner', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /** Send report summary to a recipient email (rate-limited per artifact). */
  async sendReport(params: EmailSendReportParams): Promise<EmailSendResult> {
    return this.sdk._internalFetch<EmailSendResult>('/email/send-report', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }
}
