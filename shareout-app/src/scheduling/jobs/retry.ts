/**
 * Retry backoff for failed cron job runs.
 */
import type { RetryConfig } from './types';

/** Delay in seconds before the next attempt after failure `currentRetry`. */
export function calculateBackoffDelay(config: RetryConfig, currentRetry: number): number {
  const base = config.initialDelay;
  switch (config.backoffType) {
    case 'linear':
      return base * (currentRetry + 1);
    case 'exponential':
      return base * Math.pow(2, currentRetry);
    case 'fixed':
    default:
      return base;
  }
}
