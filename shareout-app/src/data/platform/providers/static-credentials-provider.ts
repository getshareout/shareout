import { BaseProvider, type ProviderResponse } from './base-provider';
import type { ProviderConfig, TokenResult, DirectCredentials, PageInfo, RateLimitInfo } from '../types';

// Base for connectors set up by pasting a key (AWS, Supabase): no OAuth flow, no
// token refresh, no browser-direct mode — every call is proxied server-side.
export abstract class StaticCredentialsProvider extends BaseProvider {
	async getAuthUrl(): Promise<string> {
		throw new Error(`${this.config.name} connects with pasted credentials, not OAuth`);
	}

	async handleCallback(): Promise<TokenResult> {
		throw new Error(`${this.config.name} connects with pasted credentials, not OAuth`);
	}

	async refreshToken(): Promise<TokenResult> {
		throw new Error(`${this.config.name} credentials do not refresh`);
	}

	async prepareDirectCredentials(): Promise<DirectCredentials> {
		throw new Error(`${this.config.name} runs in proxy mode only`);
	}

	extractNextPage(_response: ProviderResponse): PageInfo | null {
		return null;
	}

	extractRateLimitInfo(_response: Response): RateLimitInfo | null {
		return null;
	}

	protected fail<T>(code: string, message: string, status?: number): ProviderResponse<T> {
		return { success: false, status, error: { code, message: message.slice(0, 500) } };
	}
}

/** Base ProviderConfig fields shared by the proxy-only, pasted-key connectors. */
export const PROXY_ONLY: Pick<ProviderConfig, 'execution' | 'auth' | 'pagination'> = {
	execution: { defaultMode: 'proxy', directSupported: false, proxyRequired: true, corsAllowed: [] },
	auth: { type: 'custom', refreshable: false },
	pagination: { type: 'none', defaultLimit: 1000, maxLimit: 10000 },
};
