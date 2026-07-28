import type { CacheEntry, Env } from '../types';

function createHash(input: string): string {
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		const char = input.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash;
	}
	return Math.abs(hash).toString(36);
}

export interface CacheConfig {
	memoryTtlMs: number;
	persistedTtlMs: number;
	maxMemoryEntries: number;
	persistedType: 'artifact_json' | 'r2';
	persistedPrefix: string;
}

const DEFAULT_CONFIG: CacheConfig = {
	memoryTtlMs: 60_000,
	persistedTtlMs: 300_000,
	maxMemoryEntries: 100,
	persistedType: 'artifact_json',
	persistedPrefix: 'platform_cache',
};

export class PlatformCache {
	private memory = new Map<string, CacheEntry>();
	private config: CacheConfig;

	constructor(
		private env: Env,
		private artifactId: string,
		config?: Partial<CacheConfig>
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	static generateCacheKey(
		provider: string,
		endpoint: string,
		params?: Record<string, unknown>,
		scopeKey = 'all'
	): string {
		// scopeKey segments the cache per viewer scope so a filtered result for one
		// viewer is never served to another. 'all' = unscoped (owner / no policy).
		const base = `${provider}:${endpoint}:${scopeKey}`;
		if (!params || Object.keys(params).length === 0) {
			return base;
		}
		const sorted = JSON.stringify(params, Object.keys(params).sort());
		const hash = createHash(sorted).substring(0, 12);
		return `${base}:${hash}`;
	}

	async get<T>(key: string): Promise<CacheEntry<T> | null> {
		const memEntry = this.memory.get(key);
		if (memEntry && memEntry.expiresAt > Date.now()) {
			return memEntry as CacheEntry<T>;
		}

		if (memEntry) {
			this.memory.delete(key);
		}

		const persistedEntry = await this.getFromPersisted<T>(key);
		if (persistedEntry && persistedEntry.expiresAt > Date.now()) {
			this.memory.set(key, persistedEntry);
			return persistedEntry;
		}

		return null;
	}

	async set<T>(
		key: string,
		data: T,
		options: {
			ttlMs: number;
			provider: string;
			endpoint: string;
			persist: boolean;
			userRefreshable: boolean;
		}
	): Promise<void> {
		const entry: CacheEntry<T> = {
			data,
			createdAt: Date.now(),
			expiresAt: Date.now() + options.ttlMs,
			provider: options.provider,
			endpoint: options.endpoint,
			queryHash: key,
			userRefreshable: options.userRefreshable,
		};

		this.memory.set(key, entry);
		this.trimMemoryCache();

		if (options.persist) {
			await this.writeToPersisted(key, entry);
		}
	}

	async invalidate(options: {
		provider?: string;
		endpoint?: string;
		key?: string;
	}): Promise<number> {
		let count = 0;

		for (const [key, entry] of this.memory) {
			if (this.matchesInvalidation(entry, options)) {
				this.memory.delete(key);
				count++;
			}
		}

		count += await this.invalidatePersisted(options);

		return count;
	}

	async userRefresh(provider: string, endpoint?: string): Promise<number> {
		let count = 0;

		for (const [key, entry] of this.memory) {
			if (
				entry.userRefreshable &&
				entry.provider === provider &&
				(!endpoint || entry.endpoint === endpoint)
			) {
				this.memory.delete(key);
				count++;
			}
		}

		count += await this.invalidatePersisted({ provider, endpoint });

		return count;
	}

	async getStatus(): Promise<{
		memoryEntries: number;
		providers: Record<string, { entries: number }>;
	}> {
		const providers: Record<string, { entries: number }> = {};

		for (const entry of this.memory.values()) {
			if (!providers[entry.provider]) {
				providers[entry.provider] = { entries: 0 };
			}
			providers[entry.provider].entries++;
		}

		return {
			memoryEntries: this.memory.size,
			providers,
		};
	}

	clearMemory(): void {
		this.memory.clear();
	}

	private async getFromPersisted<T>(key: string): Promise<CacheEntry<T> | null> {
		try {
			if (this.config.persistedType === 'artifact_json') {
				const row = await this.env.DB.prepare(`
					SELECT value FROM artifact_json
					WHERE artifact_id = ? AND key = ?
				`)
					.bind(this.artifactId, `${this.config.persistedPrefix}:${key}`)
					.first<{ value: string }>();

				return row ? JSON.parse(row.value) : null;
			}

			const obj = await this.env.ARTIFACTS.get(
				`${this.config.persistedPrefix}/${this.artifactId}/${key}`
			);
			return obj ? await obj.json() : null;
		} catch {
			return null;
		}
	}

	private async writeToPersisted<T>(key: string, entry: CacheEntry<T>): Promise<void> {
		try {
			if (this.config.persistedType === 'artifact_json') {
				await this.env.DB.prepare(`
					INSERT INTO artifact_json (artifact_id, key, value, updated_at)
					VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
					ON CONFLICT(artifact_id, key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
				`)
					.bind(
						this.artifactId,
						`${this.config.persistedPrefix}:${key}`,
						JSON.stringify(entry)
					)
					.run();
			} else {
				await this.env.ARTIFACTS.put(
					`${this.config.persistedPrefix}/${this.artifactId}/${key}`,
					JSON.stringify(entry),
					{ httpMetadata: { contentType: 'application/json' } }
				);
			}
		} catch (e) {
			console.error('Failed to write to persisted cache:', e);
		}
	}

	private async invalidatePersisted(options: {
		provider?: string;
		endpoint?: string;
		key?: string;
	}): Promise<number> {
		try {
			if (options.key) {
				if (this.config.persistedType === 'artifact_json') {
					const result = await this.env.DB.prepare(`
						DELETE FROM artifact_json
						WHERE artifact_id = ? AND key = ?
					`)
						.bind(this.artifactId, `${this.config.persistedPrefix}:${options.key}`)
						.run();
					return result.meta.changes || 0;
				}

				await this.env.ARTIFACTS.delete(
					`${this.config.persistedPrefix}/${this.artifactId}/${options.key}`
				);
				return 1;
			}

			if (options.provider) {
				const pattern = options.endpoint
					? `${this.config.persistedPrefix}:${options.provider}:${options.endpoint}%`
					: `${this.config.persistedPrefix}:${options.provider}:%`;

				if (this.config.persistedType === 'artifact_json') {
					const result = await this.env.DB.prepare(`
						DELETE FROM artifact_json
						WHERE artifact_id = ? AND key LIKE ?
					`)
						.bind(this.artifactId, pattern)
						.run();
					return result.meta.changes || 0;
				}
			}

			return 0;
		} catch {
			return 0;
		}
	}

	private matchesInvalidation(
		entry: CacheEntry,
		options: { provider?: string; endpoint?: string; key?: string }
	): boolean {
		if (options.key && entry.queryHash !== options.key) {
			return false;
		}
		if (options.provider && entry.provider !== options.provider) {
			return false;
		}
		if (options.endpoint && entry.endpoint !== options.endpoint) {
			return false;
		}
		return true;
	}

	private trimMemoryCache(): void {
		if (this.memory.size <= this.config.maxMemoryEntries) {
			return;
		}

		const entries = Array.from(this.memory.entries()).sort(
			(a, b) => a[1].createdAt - b[1].createdAt
		);

		const toRemove = entries.slice(0, entries.length - this.config.maxMemoryEntries);
		for (const [key] of toRemove) {
			this.memory.delete(key);
		}
	}
}
