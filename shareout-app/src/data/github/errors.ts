/** Safe client messages for GitHub integration — never expose upstream/D1/crypto internals. */

export function userFacingOAuthError(_err: unknown): string {
  return 'GitHub authorization failed';
}

export function userFacingReposError(_err: unknown): string {
  return 'Failed to list repositories';
}

export function userFacingExportError(_err: unknown): string {
  return 'Export failed';
}
