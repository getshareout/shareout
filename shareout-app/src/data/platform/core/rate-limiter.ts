import type { RateLimitInfo } from '../types';

export interface RateLimitConfig {
	requestsPerMinute: number;
	requestsPerSecond?: number;
	burstLimit?: number;
	tracking: 'per-provider' | 'per-connection' | 'per-artifact';
}

interface RateLimitWindow {
	count: number;
	windowStart: number;
	secondBucket?: {
		count: number;
		second: number;
	};
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	limit: number;
	resetAt: number;
	retryAfterMs?: number;
}

export class PlatformRateLimiter {
	private windows = new Map<string, RateLimitWindow>();

	constructor(private config: RateLimitConfig) {}

	getKey(provider: string, connectionId: string, artifactId: string): string {
		switch (this.config.tracking) {
			case 'per-provider':
				return `ratelimit:${provider}`;
			case 'per-connection':
				return `ratelimit:${provider}:${connectionId}`;
			case 'per-artifact':
				return `ratelimit:${provider}:${artifactId}`;
		}
	}

	checkAndConsume(key: string): RateLimitResult {
		const now = Date.now();
		const windowStart = Math.floor(now / 60000) * 60000;
		const currentSecond = Math.floor(now / 1000);

		let window = this.windows.get(key);

		if (!window || now - window.windowStart >= 60000) {
			window = { count: 0, windowStart };
			this.windows.set(key, window);
		}

		if (this.config.requestsPerSecond) {
			if (!window.secondBucket || window.secondBucket.second !== currentSecond) {
				window.secondBucket = { count: 0, second: currentSecond };
			}

			if (window.secondBucket.count >= this.config.requestsPerSecond) {
				return {
					allowed: false,
					remaining: 0,
					limit: this.config.requestsPerSecond,
					resetAt: (currentSecond + 1) * 1000,
					retryAfterMs: 1000 - (now % 1000),
				};
			}
		}

		if (window.count >= this.config.requestsPerMinute) {
			return {
				allowed: false,
				remaining: 0,
				limit: this.config.requestsPerMinute,
				resetAt: window.windowStart + 60000,
				retryAfterMs: window.windowStart + 60000 - now,
			};
		}

		window.count++;
		if (window.secondBucket) {
			window.secondBucket.count++;
		}

		return {
			allowed: true,
			remaining: this.config.requestsPerMinute - window.count,
			limit: this.config.requestsPerMinute,
			resetAt: window.windowStart + 60000,
		};
	}

	recordDirectUsage(key: string, count: number = 1): void {
		const now = Date.now();
		const windowStart = Math.floor(now / 60000) * 60000;

		let window = this.windows.get(key);

		if (!window || now - window.windowStart >= 60000) {
			window = { count: 0, windowStart };
			this.windows.set(key, window);
		}

		window.count += count;
	}

	getInfo(key: string): RateLimitInfo {
		const now = Date.now();
		const window = this.windows.get(key);

		if (!window || now - window.windowStart >= 60000) {
			return {
				remaining: this.config.requestsPerMinute,
				limit: this.config.requestsPerMinute,
				resetAt: Math.floor(now / 60000) * 60000 + 60000,
			};
		}

		return {
			remaining: Math.max(0, this.config.requestsPerMinute - window.count),
			limit: this.config.requestsPerMinute,
			resetAt: window.windowStart + 60000,
		};
	}

	cleanup(): void {
		const now = Date.now();
		for (const [key, window] of this.windows) {
			if (now - window.windowStart >= 120000) {
				this.windows.delete(key);
			}
		}
	}
}

const rateLimiters = new Map<string, PlatformRateLimiter>();

export function getRateLimiter(providerId: string, config: RateLimitConfig): PlatformRateLimiter {
	const key = `${providerId}:${config.tracking}`;
	let limiter = rateLimiters.get(key);

	if (!limiter) {
		limiter = new PlatformRateLimiter(config);
		rateLimiters.set(key, limiter);
	}

	return limiter;
}

export function cleanupRateLimiters(): void {
	for (const limiter of rateLimiters.values()) {
		limiter.cleanup();
	}
}
