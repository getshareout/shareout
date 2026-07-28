import { BaseProvider, type ProviderResponse } from '../base-provider';
import type {
	ProviderEndpoint,
	AuthContext,
	TokenResult,
	DirectCredentials,
	DecryptedCredentials,
	PageInfo,
	RateLimitInfo,
} from '../../types';
import { SLACK_CONFIG } from './config';
import { registerProvider } from '../../registry';
import { createLogger, logError } from '../../../../logging';
import { userFacingAuthTokenError } from '../../errors';

interface SlackOAuthResponse {
	ok: boolean;
	error?: string;
	access_token?: string;
	token_type?: string;
	scope?: string;
	bot_user_id?: string;
	app_id?: string;
	team?: { id?: string; name?: string };
}

class SlackProvider extends BaseProvider {
	readonly config = SLACK_CONFIG;
	readonly endpoints = new Map<string, ProviderEndpoint>();

	async getAuthUrl(ctx: AuthContext): Promise<string> {
		const oauth = this.config.auth.oauth!;
		const params = new URLSearchParams({
			client_id: ctx.env.SLACK_CLIENT_ID,
			scope: oauth.scopes.join(','),
			redirect_uri: ctx.callbackUrl,
			state: ctx.state,
		});
		return `${oauth.authorizationUrl}?${params}`;
	}

	async handleCallback(ctx: AuthContext, code: string): Promise<TokenResult> {
		const oauth = this.config.auth.oauth!;
		const response = await fetch(oauth.tokenUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: ctx.env.SLACK_CLIENT_ID,
				client_secret: ctx.env.SLACK_CLIENT_SECRET,
				code,
				redirect_uri: ctx.callbackUrl,
			}),
		});

		const data = (await response.json()) as SlackOAuthResponse;
		// Slack always returns HTTP 200; failures are signalled by ok:false.
		if (!data.ok || !data.access_token) {
			const slackError = data.error || 'unknown_error';
			logError(
				createLogger(ctx.env, {
					scope: 'platform',
					provider: 'slack',
					event: 'oauth.token.failed',
					slack_error: slackError,
				}),
				'Slack OAuth token exchange failed',
				new Error(slackError),
			);
			throw new Error(userFacingAuthTokenError(new Error(slackError)));
		}

		return {
			accessToken: data.access_token,
			scope: data.scope,
			tokenType: data.token_type,
			extra: {
				team_id: data.team?.id,
				team_name: data.team?.name,
				bot_user_id: data.bot_user_id,
				app_id: data.app_id,
			},
		};
	}

	async refreshToken(): Promise<TokenResult> {
		throw new Error('Slack bot tokens do not expire and cannot be refreshed');
	}

	async prepareDirectCredentials(
		_ctx: AuthContext,
		_credentials: DecryptedCredentials
	): Promise<DirectCredentials> {
		throw new Error('Slack does not support direct mode due to CORS restrictions');
	}

	async executeRequest<T = unknown>(): Promise<ProviderResponse<T>> {
		// Slack delivery is driven by src/slack/send.ts, not the platform query engine.
		throw new Error('Slack provider does not expose query endpoints');
	}

	extractNextPage(): PageInfo | null {
		return null;
	}

	extractRateLimitInfo(response: Response): RateLimitInfo | null {
		const retryAfter = response.headers.get('Retry-After');
		if (!retryAfter) return null;
		return { remaining: 0, limit: 0, resetAt: Date.now() + Number(retryAfter) * 1000 };
	}
}

const slackProvider = new SlackProvider();
registerProvider(slackProvider);

export { slackProvider };
export { SLACK_CONFIG } from './config';
