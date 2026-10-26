export class ShareOutError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    // Actionable detail the API computes alongside every error. The worker sends
    // these on the JSON envelope; surface them so callers see "how to fix it", not
    // just "what broke" (hint = why, suggestion = the fix, param = offending field,
    // docs = a URL).
    public hint?: string,
    public suggestion?: string,
    public param?: string,
    public docs?: string,
    // `request_id` from the envelope: quote it in a support ticket.
    public requestId?: string,
    // Finer-grained cause under a stable `code` (e.g. UNAUTHORIZED → missing | expired).
    public reason?: string
  ) {
    super(message);
    this.name = 'ShareOutError';
  }
}


export class ConsentRequiredError extends ShareOutError {
  constructor(message: string, status: number, public consentUrl: string, hint?: string, requestId?: string) {
    super(message, 'CONSENT_REQUIRED', status, hint, undefined, undefined, undefined, requestId);
    this.name = 'ConsentRequiredError';
  }
}
