/** A single decoded Server-Sent Event payload. The shape of the `data:` JSON is
 *  app-defined; `type` is the common discriminator every ShareOut chat stream uses. */
export interface SSEEvent {
  type?: string;
  [key: string]: unknown;
}
