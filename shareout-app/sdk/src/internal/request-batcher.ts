import { ShareOutError } from '../shareout-error';

export interface DirectFetchClient {
  _directFetch<T = unknown>(path: string, options?: RequestInit): Promise<T>;
}

interface BatchedRequest {
  path: string;
  method?: string;
  body?: unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export class RequestBatcher {
  private queue: BatchedRequest[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly MAX_BATCH_SIZE = 20;

  constructor(
    private client: DirectFetchClient,
    private delay: number = 5
  ) {}

  async batch<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    // Don't batch mutations
    if (method !== 'GET') {
      return this.client._directFetch<T>(path, { method, body: body ? JSON.stringify(body) : undefined });
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({ path, method, body, resolve: resolve as (v: unknown) => void, reject });

      if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.delay);
      }

      // Flush immediately if queue is full
      if (this.queue.length >= this.MAX_BATCH_SIZE) {
        this.flush();
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const requests = this.queue.splice(0, this.MAX_BATCH_SIZE);
    if (requests.length === 0) return;

    // Single request: no batching needed
    if (requests.length === 1) {
      const req = requests[0];
      try {
        const result = await this.client._directFetch(req.path, {
          method: req.method,
          body: req.body ? JSON.stringify(req.body) : undefined,
        });
        req.resolve(result);
      } catch (e) {
        req.reject(e);
      }
      return;
    }

    // Batch request
    try {
      const response = await this.client._directFetch<{
        results: Array<{
          path: string;
          success: boolean;
          data?: unknown;
          error?: string;
          code?: string;
        }>;
      }>('/batch', {
        method: 'POST',
        body: JSON.stringify({
          requests: requests.map(r => ({ path: r.path, method: r.method, body: r.body })),
        }),
      });

      const resultMap = new Map(response.results.map(r => [r.path, r]));

      for (const req of requests) {
        const result = resultMap.get(req.path);
        if (result?.success) {
          req.resolve(result.data);
        } else {
          req.reject(new ShareOutError(
            result?.error || 'Batch request failed',
            result?.code || 'BATCH_ERROR',
            400
          ));
        }
      }
    } catch (e) {
      // If batch fails, reject all
      for (const req of requests) {
        req.reject(e);
      }
    }
  }
}

