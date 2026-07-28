import type { ProviderConfig } from './types';
import type { BaseProvider } from './providers/base-provider';

interface ProviderRegistry {
	providers: Map<string, BaseProvider>;
	initialized: boolean;
}

const registry: ProviderRegistry = {
	providers: new Map(),
	initialized: false,
};

export function registerProvider(provider: BaseProvider): void {
	const id = provider.config.id;
	if (registry.providers.has(id)) {
		console.warn(`Provider ${id} already registered, skipping duplicate registration`);
		return;
	}
	registry.providers.set(id, provider);
}

export function getProvider(id: string): BaseProvider | undefined {
	return registry.providers.get(id);
}

export function hasProvider(id: string): boolean {
	return registry.providers.has(id);
}

export function listProviders(): ProviderConfig[] {
	return Array.from(registry.providers.values()).map((p) => p.config);
}

export async function initializeProviders(): Promise<void> {
	if (registry.initialized) {
		return;
	}

	registry.initialized = true;
}
