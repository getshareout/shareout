/** A refusal the routes turn into the standard API error envelope. */
export class TemplateError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const isTemplateError = (e: unknown): e is TemplateError => e instanceof TemplateError;
