/** Safe user-facing messages for Data Platform providers — never leak token exchange or upstream bodies. */

import { CREDENTIALS_REQUIRED } from './core/credentials';
import { PLATFORM_ERRORS } from './types';

const PLATFORM_PROVIDER_LABELS: Record<string, string> = {
	'google-sheets': 'Google Sheets',
	'google-analytics': 'Google Analytics',
	'google-ads': 'Google Ads',
	shopify: 'Shopify',
	tiendanube: 'Tienda Nube',
	bigquery: 'BigQuery',
	snowflake: 'Snowflake',
	slack: 'Slack',
	'facebook-ads': 'Facebook Ads',
};

/** Never expose token exchange, D1, or crypto internals in artifact OAuth popup pages. */
export function userFacingPlatformOAuthError(providerId: string, _err: unknown): string {
	const label = PLATFORM_PROVIDER_LABELS[providerId] ?? 'Connection';
	return `${label} authorization failed`;
}

/** OAuth redirect denial (`error` query param) — provider codes/descriptions are user-facing. */
export function platformOAuthDenialMessage(url: URL): string | null {
	const error = url.searchParams.get('error');
	if (!error) return null;
	return url.searchParams.get('error_description') || error;
}

/** Token mint/refresh failures (service account JWT, authorized-user refresh). */
export function userFacingAuthTokenError(_err: unknown): string {
	return 'Failed to obtain access token';
}

/** verifyConnection upstream probe failures — HTTP status only. */
export function userFacingVerifyUpstreamError(httpStatus: number): string {
	return `API request failed (HTTP ${httpStatus})`;
}

/** Provider executeRequest upstream failures — HTTP status only. */
export function userFacingProviderUpstreamError(httpStatus: number): string {
	return `Provider request failed (HTTP ${httpStatus})`;
}

/** Snowflake key-pair JWT signing failures — never leak crypto/import internals. */
export function userFacingSnowflakeJwtError(_err: unknown): string {
	return 'Failed to sign Snowflake credentials';
}

/** User-actionable prepare errors — never D1/crypto/token-exchange internals. */
export function isSafePrepareMessage(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const msg = err.message;
	if (msg === CREDENTIALS_REQUIRED) return true;
	for (const e of Object.values(PLATFORM_ERRORS)) {
		if (msg === e.message) return true;
	}
	if (msg === 'Connection not found') return true;
	if (msg === 'Failed to obtain access token') return true;
	if (msg.includes('does not support direct')) return true;
	if (msg.includes('runs in proxy mode only')) return true;
	if (msg.includes('CORS restrictions')) return true;
	if (msg.includes('connects with')) return true;
	if (msg.includes('does not use an OAuth callback')) return true;
	if (msg.includes('does not expire and cannot be refreshed')) return true;
	if (msg.includes('is required for')) return true;
	if (msg.includes('No ') && msg.includes('credentials available')) return true;
	if (msg.includes('does not expose query endpoints')) return true;
	if (msg.includes('uses key-pair auth')) return true;
	if (msg.includes('refreshes tokens internally')) return true;
	if (msg.includes('long-lived tokens are not refreshable')) return true;
	if (msg.includes('service-account tokens are minted per request')) return true;
	if (msg.includes('key-pair credentials do not refresh')) return true;
	return false;
}

/** Safe user-facing text for platform prepare failures. */
export function userFacingPrepareError(err: unknown): string {
	if (err instanceof Error) {
		if (err.message === CREDENTIALS_REQUIRED) {
			return PLATFORM_ERRORS.CREDENTIALS_REQUIRED.message;
		}
		if (isSafePrepareMessage(err)) return err.message;
	}
	return 'Failed to prepare credentials';
}

/** Map prepare failures to safe API responses with correct HTTP status. */
export function mapPrepareFailure(err: unknown): { code: string; message: string; status: number } {
	if (err instanceof Error) {
		if (err.message === CREDENTIALS_REQUIRED) {
			return {
				code: 'CREDENTIALS_REQUIRED',
				message: PLATFORM_ERRORS.CREDENTIALS_REQUIRED.message,
				status: 403,
			};
		}
		if (err.message === PLATFORM_ERRORS.PROVIDER_NOT_FOUND.message || err.message === PLATFORM_ERRORS.ENDPOINT_NOT_FOUND.message) {
			return { code: err.message === PLATFORM_ERRORS.PROVIDER_NOT_FOUND.message ? 'PROVIDER_NOT_FOUND' : 'ENDPOINT_NOT_FOUND', message: err.message, status: 404 };
		}
		if (err.message === 'Connection not found') {
			return { code: 'CONNECTION_NOT_FOUND', message: err.message, status: 404 };
		}
		if (err.message === PLATFORM_ERRORS.SCOPE_REQUIRED.message) {
			return { code: 'SCOPE_REQUIRED', message: err.message, status: 403 };
		}
		if (err.message === PLATFORM_ERRORS.INVALID_CREDENTIALS.message || err.message === 'Failed to obtain access token') {
			return { code: 'INVALID_CREDENTIALS', message: err.message, status: 401 };
		}
		if (err.message === PLATFORM_ERRORS.DIRECT_NOT_SUPPORTED.message) {
			return { code: 'DIRECT_NOT_SUPPORTED', message: err.message, status: 400 };
		}
		if (err.message === PLATFORM_ERRORS.RATE_LIMITED.message) {
			return { code: 'RATE_LIMITED', message: err.message, status: 429 };
		}
	}
	if (isSafePrepareMessage(err)) {
		const message = err instanceof Error ? err.message : 'Failed to prepare credentials';
		return { code: 'PREPARE_ERROR', message, status: 400 };
	}
	return {
		code: 'PREPARE_ERROR',
		message: userFacingPrepareError(err),
		status: 500,
	};
}
