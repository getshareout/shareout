import type { ProviderConfig, ProviderEndpoint, ExecutionMode, ConnectionConfig } from '../types';

export interface ModeResolverContext {
	provider: ProviderConfig;
	endpoint: ProviderEndpoint;
	requestOrigin?: string;
	connectionConfig: ConnectionConfig;
	userPreference?: ExecutionMode;
}

export function resolveExecutionMode(ctx: ModeResolverContext): ExecutionMode {
	if (ctx.provider.execution.proxyRequired) {
		return 'proxy';
	}

	if (ctx.endpoint.execution?.requiresProxy) {
		return 'proxy';
	}

	if (ctx.userPreference && ctx.userPreference !== 'auto') {
		if (ctx.userPreference === 'direct' && !ctx.provider.execution.directSupported) {
			return 'proxy';
		}
		return ctx.userPreference;
	}

	if (ctx.connectionConfig.preferredMode !== 'auto') {
		if (ctx.connectionConfig.preferredMode === 'direct' && !ctx.provider.execution.directSupported) {
			return 'proxy';
		}
		return ctx.connectionConfig.preferredMode;
	}

	if (ctx.provider.execution.directSupported) {
		if (ctx.requestOrigin && ctx.provider.execution.corsAllowed.length > 0) {
			const originAllowed = ctx.provider.execution.corsAllowed.some((allowed) => {
				if (allowed.startsWith('*.')) {
					const domain = allowed.slice(2);
					return ctx.requestOrigin!.endsWith(domain);
				}
				return ctx.requestOrigin === allowed || ctx.requestOrigin!.endsWith(allowed);
			});

			if (originAllowed) {
				return 'direct';
			}
		}

		if (ctx.provider.execution.corsAllowed.length === 0) {
			return 'direct';
		}
	}

	return ctx.provider.execution.defaultMode === 'auto' ? 'proxy' : ctx.provider.execution.defaultMode;
}

export function canUseDirectMode(provider: ProviderConfig, endpoint?: ProviderEndpoint): boolean {
	if (provider.execution.proxyRequired) {
		return false;
	}

	if (!provider.execution.directSupported) {
		return false;
	}

	if (endpoint?.execution?.requiresProxy) {
		return false;
	}

	return true;
}

export function getRecommendedMode(provider: ProviderConfig): ExecutionMode {
	if (provider.execution.proxyRequired) {
		return 'proxy';
	}

	if (provider.execution.directSupported) {
		return 'direct';
	}

	return provider.execution.defaultMode;
}
