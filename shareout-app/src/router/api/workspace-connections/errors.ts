/** Safe user-facing messages for workspace connector OAuth callbacks. */

const PROVIDER_LABELS: Record<string, string> = {
	slack: 'Slack',
	'google-sheets': 'Google Sheets',
	shopify: 'Shopify',
	tiendanube: 'Tienda Nube',
	bigquery: 'BigQuery',
};

/** Never expose token exchange, D1, or crypto internals in OAuth popup pages. */
export function userFacingWorkspaceOAuthError(providerId: string, _err: unknown): string {
	const label = PROVIDER_LABELS[providerId] ?? 'Connection';
	return `${label} authorization failed`;
}

/** OAuth redirect denial (`error` query param) — provider codes/descriptions are user-facing. */
export function oauthDenialMessage(url: URL): string | null {
	const error = url.searchParams.get('error');
	if (!error) return null;
	return url.searchParams.get('error_description') || error;
}
