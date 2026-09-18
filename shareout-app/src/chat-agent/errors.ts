import type { Env } from '../types';
import { createLogger, logError } from '../logging';
import { FetchTimeoutError } from '../fetch-utils';
import {
  UpstreamHttpError,
  userFacingConnectionToolError,
} from '../data/connections/errors';

/** Validation-style messages tools may throw — never D1/crypto/provider internals. */
function isSafeAgentToolMessage(msg: string): boolean {
  if (msg.endsWith(' is required')) return true;
  if (msg.startsWith('No file "') && msg.includes(' in your library.')) return true;
  if (msg === 'File content missing from storage.') return true;
  return false;
}

/** User-actionable parse limits from summarizeFile / parseXlsx — safe to show in chat. */
function isSafeReadFileParseMessage(msg: string): boolean {
  return msg.startsWith('Spreadsheet too large to read');
}

/** Known upsertShareeContextFile error codes — safe to map to user-facing text. */
const SHAREE_CONTEXT_UPSERT_ERRORS: Record<string, string> = {
  INVALID_NAME: 'Note name must be lowercase and end in .md.',
  EMPTY_CONTENT: 'Note content cannot be empty.',
  TOO_LARGE: 'Note is too large (max 64KB).',
  NOT_FOUND: 'That client was not found.',
  LIMIT_REACHED: 'Too many notes for this client (max 100 files).',
};

export function isKnownShareeContextUpsertError(code: string): boolean {
  return code in SHAREE_CONTEXT_UPSERT_ERRORS;
}

/** Safe set_client_notes tool error — never leak internal upsert codes or D1 errors. */
export function userFacingClientNotesError(err: unknown): string {
  if (typeof err === 'string' && SHAREE_CONTEXT_UPSERT_ERRORS[err]) {
    return SHAREE_CONTEXT_UPSERT_ERRORS[err];
  }
  if (err instanceof Error && isSafeAgentToolMessage(err.message)) {
    return err.message;
  }
  return 'Couldn\u2019t save the note. Try again.';
}

/** Safe read_file tool error — never leak zip/parser/crypto internals to the transcript. */
export function userFacingReadFileError(err: unknown, filename: string): string {
  if (err instanceof Error && isSafeReadFileParseMessage(err.message)) {
    return err.message;
  }
  return `Could not read ${filename}. The file may be corrupted or in an unsupported format.`;
}

/** Safe tool-result error text for the agent transcript — never leak upstream bodies or infra errors. */
export function userFacingAgentToolError(err: unknown, fallback = 'Tool failed.'): string {
  if (err instanceof FetchTimeoutError || err instanceof UpstreamHttpError) {
    return userFacingConnectionToolError(err, fallback);
  }
  if (err instanceof Error) {
    if (err.message === 'CREDENTIALS_REQUIRED') {
      return 'Connect your credentials for this connector before querying.';
    }
    if (isSafeAgentToolMessage(err.message)) {
      return err.message;
    }
  }
  return fallback;
}

export function logAgentToolFailure(
  env: Env,
  fields: { tool: string; userId: string; platform?: string },
  err: unknown,
): void {
  logError(
    createLogger(env, {
      scope: 'chat-agent',
      event: 'chat_agent.tool.failed',
      tool: fields.tool,
      user_id: fields.userId,
      platform: fields.platform,
    }),
    'chat agent tool failed',
    err,
  );
}
