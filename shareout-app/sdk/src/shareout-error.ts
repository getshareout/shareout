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
    public docs?: string
  ) {
    super(message);
    this.name = 'ShareOutError';
  }
}

