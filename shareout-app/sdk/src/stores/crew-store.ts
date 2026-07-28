import { readSSE } from '@shareout/chat-core/sse';
import type { SdkClient } from '../core/sdk-client';

export interface CrewToolGrant {
  read?: string[];
  /** Write tools (Phase 2): comment_create, table_insert, table_update, email_send. */
  write?: string[];
  /** Per-tool approval policy override: 'never' | 'always' | 'whenPublic'. */
  approval?: Record<string, 'never' | 'always' | 'whenPublic'>;
  limits?: Record<string, { maxRows?: number; maxCalls?: number; maxBytes?: number }>;
}

export interface CrewDefineConfig {
  name?: string;
  instructions: string;
  model?: 'claude-sonnet-4-20250514' | 'claude-3-5-haiku-20241022';
  maxIterations?: number;
  runBudgetMicroUsd?: number;
  tools?: CrewToolGrant;
}

export interface CrewConditionConfig {
  /** Optional gate: count rows in a table matching a filter and compare. */
  predicate?: {
    table: string;
    where?: Record<string, unknown>;
    op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
    value: number;
  };
  /** Fallback seconds until the next check after a run (1h–30d). The crew can override per run. */
  cooldownSeconds?: number;
}

export interface CrewTriggerConfig {
  kind: 'cron' | 'event' | 'condition';
  /** Cron expression (5-field) when kind='cron'. Note: dispatch is hourly-granular. */
  cron?: string;
  /** Event name when kind='event' (Phase 1: 'table.row.inserted'). */
  eventType?: string;
  /** Predicate + cooldown when kind='condition'. Omit predicate for a self-scheduled agent. */
  condition?: CrewConditionConfig;
}

export interface CrewRunEvent {
  type: 'run_start' | 'reasoning' | 'tool_call' | 'tool_result' | 'finish' | 'error' | 'done';
  runId?: string;
  content?: string;
  tool?: string;
  input?: unknown;
  result?: unknown;
  is_error?: boolean;
  summary?: string;
  status?: string;
  error?: string;
  terminationReason?: string;
  iterations?: number;
  costMicroUsd?: number;
}

/**
 * Crew — a standing helper for this app that reasons over its data with
 * read-only tools and reports back. Phase 0: owner-defined, manually run.
 */
export class CrewStore {
  constructor(private sdk: SdkClient) {}

  /** Create or update this app's crew (owner only). */
  async define(config: CrewDefineConfig): Promise<{ crew: unknown }> {
    return this.sdk._internalFetch('/crew/define', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  /** Read this app's crew config + granted tools (owner only). */
  async get(): Promise<{ crew: unknown; grants: unknown[] }> {
    return this.sdk._internalFetch('/crew');
  }

  /** Run the crew now, streaming reasoning, tool calls, and the final summary. */
  async *run(options: { input?: string } = {}): AsyncGenerator<CrewRunEvent> {
    yield* this.streamSse('/crew/run', {
      method: 'POST',
      body: JSON.stringify({ input: options.input ?? '' }),
    });
  }

  get runs() {
    return {
      list: async (options?: { limit?: number }): Promise<{ runs: unknown[] }> => {
        const params = new URLSearchParams();
        if (options?.limit) params.set('limit', String(options.limit));
        const query = params.toString() ? `?${params.toString()}` : '';
        return this.sdk._internalFetch(`/crew/runs${query}`);
      },

      get: async (runId: string): Promise<{ run: unknown; events: unknown[] }> => {
        return this.sdk._internalFetch(`/crew/runs/${encodeURIComponent(runId)}`);
      },

      stream: (runId: string): AsyncGenerator<CrewRunEvent> => {
        return this.streamSse(`/crew/runs/${encodeURIComponent(runId)}/stream`, { method: 'GET' });
      },
    };
  }

  /** Workspace-level crew rollup: runs × cost × tools × errors × approvals. */
  async usage(workspaceId: string): Promise<unknown> {
    return this.sdk._authFetch(`/workspaces/${encodeURIComponent(workspaceId)}/crew-usage`);
  }

  /** Owner-gated approvals for write/side-effect actions a crew queued. */
  get approvals() {
    return {
      list: async (status?: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'): Promise<{ approvals: unknown[] }> => {
        const q = status ? `?status=${encodeURIComponent(status)}` : '';
        return this.sdk._internalFetch(`/crew/approvals${q}`);
      },

      approve: async (approvalId: string): Promise<{ status: string; result?: unknown; error?: string }> => {
        return this.sdk._internalFetch(`/crew/approvals/${encodeURIComponent(approvalId)}/approve`, {
          method: 'POST',
        });
      },

      reject: async (approvalId: string): Promise<{ rejected: boolean }> => {
        return this.sdk._internalFetch(`/crew/approvals/${encodeURIComponent(approvalId)}/reject`, {
          method: 'POST',
        });
      },
    };
  }

  /** Triggers that wake the crew automatically (cron schedule or app event). */
  get triggers() {
    return {
      list: async (): Promise<{ triggers: unknown[] }> => {
        return this.sdk._internalFetch('/crew/triggers');
      },

      create: async (config: CrewTriggerConfig): Promise<{ trigger: unknown }> => {
        return this.sdk._internalFetch('/crew/triggers', {
          method: 'POST',
          body: JSON.stringify(config),
        });
      },

      update: async (
        triggerId: string,
        patch: { enabled?: boolean; cron?: string; eventType?: string }
      ): Promise<{ trigger: unknown }> => {
        return this.sdk._internalFetch(`/crew/triggers/${encodeURIComponent(triggerId)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
      },

      delete: async (triggerId: string): Promise<{ deleted: boolean }> => {
        return this.sdk._internalFetch(`/crew/triggers/${encodeURIComponent(triggerId)}`, {
          method: 'DELETE',
        });
      },
    };
  }

  private async *streamSse(path: string, init: RequestInit): AsyncGenerator<CrewRunEvent> {
    const url = `${this.sdk._baseUrl}/v1/data/${this.sdk._artifactId}${path}`;

    const response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });

    if (!response.ok) {
      yield { type: 'error', error: `Request failed (${response.status})` };
      return;
    }

    if (!response.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    for await (const ev of readSSE(response)) {
      yield ev as CrewRunEvent;
    }
  }
}
