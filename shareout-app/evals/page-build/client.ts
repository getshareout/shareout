/**
 * The public API, as far as the eval needs it. Every call is a plain fetch with a bearer
 * token; the token lives only in the Authorization header and in no error or log line.
 *
 *   POST   /v1/workspace/{ws}/agent/chat      SSE: thread, text, confirm{token}, done   (the assistant proposes a build)
 *   POST   /v1/workspace/{ws}/agent/confirm   SSE build_step / build_done  (build)  or  JSON {ok,text}  (edit)
 *   POST   /v1/publish                        seed pages for the edit items
 *   GET    /v1/artifacts/{id}/files[?version=N]
 *   POST   /v1/artifacts/{id}/verify
 *   POST   /v1/artifacts/{id}/tags            DELETE /v1/artifacts/{id}
 *   GET    /v1/workspaces/{ws}/usage          (totals, to attribute spend per run)
 */
import type { SeedFile, Usage } from './types';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  origin: string;
  token: string;
  fetch?: FetchFn;
  /** Per-call ceilings in ms; a build can take minutes. */
  timeouts?: { chat: number; confirm: number; verify: number; other: number };
}

export class ApiError extends Error {
  constructor(public status: number, public path: string, message: string) {
    super(`${path}: ${status} ${message}`);
  }
}

export interface ChatResult {
  threadId?: string;
  text: string;
  /** Set when the assistant proposed an action that needs confirming. */
  confirm?: { token: string; prompt: string };
  error?: string;
}

export interface ConfirmResult {
  ok: boolean;
  text: string;
  steps: string[];
  artifactId?: string;
  url?: string;
  name?: string;
}

export interface FilesResult {
  versionNo: number;
  files: Array<{ path: string; content: string; mime?: string }>;
}

export const DEFAULT_TIMEOUTS = { chat: 180_000, confirm: 900_000, verify: 180_000, other: 60_000 };

/** The `data:` JSON events of an SSE body; events that are not JSON are skipped. */
export function parseSse(body: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const block of body.split(/\n\n+/)) {
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) continue;
    try {
      const ev = JSON.parse(data) as unknown;
      if (ev && typeof ev === 'object') events.push(ev as Record<string, unknown>);
    } catch { /* keep-alive or partial line */ }
  }
  return events;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export function createClient(opts: ClientOptions) {
  const origin = opts.origin.replace(/\/+$/, '');
  const doFetch: FetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  const timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };

  async function call(path: string, init: { method?: string; body?: unknown; timeout: number }): Promise<Response> {
    const res = await doFetch(`${origin}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/json, text/event-stream',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(init.timeout),
    });
    if (!res.ok) {
      const detail = await res.text().then((t) => { try { return str((JSON.parse(t) as { error?: unknown }).error) ?? t; } catch { return t; } }).catch(() => '');
      throw new ApiError(res.status, path, detail.slice(0, 300));
    }
    return res;
  }

  const json = async <T>(path: string, init: { method?: string; body?: unknown; timeout?: number } = {}): Promise<T> =>
    (await call(path, { ...init, timeout: init.timeout ?? timeouts.other })).json() as Promise<T>;

  return {
    /** One assistant turn. A build request normally ends with a confirm token. */
    async chat(workspace: string, text: string): Promise<ChatResult> {
      const res = await call(`/v1/workspace/${encodeURIComponent(workspace)}/agent/chat`, { method: 'POST', body: { text }, timeout: timeouts.chat });
      const out: ChatResult = { text: '' };
      for (const ev of parseSse(await res.text())) {
        if (ev.type === 'thread') out.threadId = str(ev.id);
        else if (ev.type === 'text') out.text += (out.text ? '\n' : '') + (str(ev.text) ?? '');
        else if (ev.type === 'confirm' && str(ev.token)) out.confirm = { token: str(ev.token)!, prompt: str(ev.prompt) ?? '' };
        else if (ev.type === 'error') out.error = str(ev.message) ?? 'error';
      }
      return out;
    },

    /** Run what the assistant proposed. Builds stream steps and end in build_done; other actions answer in JSON. */
    async confirm(workspace: string, token: string): Promise<ConfirmResult> {
      const res = await call(`/v1/workspace/${encodeURIComponent(workspace)}/agent/confirm`, { method: 'POST', body: { token }, timeout: timeouts.confirm });
      if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        const j = await res.json() as { ok?: boolean; text?: string };
        return { ok: j.ok !== false, text: j.text ?? '', steps: [] };
      }
      const out: ConfirmResult = { ok: false, text: 'The build stream ended without a result', steps: [] };
      for (const ev of parseSse(await res.text())) {
        if (ev.type === 'build_step') out.steps.push(str(ev.label) ?? '');
        else if (ev.type === 'build_done') {
          out.ok = ev.ok === true;
          out.text = str(ev.text) ?? '';
          out.artifactId = str(ev.artifactId);
          out.url = str(ev.url);
          out.name = str(ev.name);
        } else if (ev.type === 'error') out.text = str(ev.message) ?? out.text;
      }
      return out;
    },

    async publish(workspace: string, name: string, files: SeedFile[]): Promise<{ artifactId: string; version: number }> {
      const r = await json<{ artifact: { id: string }; version: { version_no: number } }>('/v1/publish', {
        method: 'POST',
        body: { name, files, workspace_id: workspace, visibility: 'private' },
      });
      return { artifactId: r.artifact.id, version: r.version.version_no };
    },

    /** The live version's files, or `version` when given. */
    async files(artifactId: string, version?: number): Promise<FilesResult> {
      const r = await json<{ version_no: number; files: Array<{ path: string; content: string; encoding?: string; mime?: string }> }>(
        `/v1/artifacts/${encodeURIComponent(artifactId)}/files${version ? `?version=${version}` : ''}`,
      );
      return { versionNo: r.version_no, files: r.files.filter((f) => f.encoding !== 'base64').map(({ path, content, mime }) => ({ path, content, mime })) };
    },

    /** The raw verify body (see scoreVerify). Needs a browser on the instance; without one it answers partial. */
    verify(artifactId: string, version: number): Promise<unknown> {
      return json(`/v1/artifacts/${encodeURIComponent(artifactId)}/verify`, { method: 'POST', body: { version }, timeout: timeouts.verify });
    },

    async tag(artifactId: string, label: string): Promise<void> {
      await json(`/v1/artifacts/${encodeURIComponent(artifactId)}/tags`, { method: 'POST', body: { label } });
    },

    async remove(artifactId: string): Promise<void> {
      await json(`/v1/artifacts/${encodeURIComponent(artifactId)}`, { method: 'DELETE' });
    },

    /** The workspace's running totals; two readings around a run give its spend. Null when unreadable. */
    async usageTotals(workspace: string): Promise<Usage | null> {
      try {
        const r = await json<{ totals?: { tokens?: number; costUsd?: number } }>(`/v1/workspaces/${encodeURIComponent(workspace)}/usage?limit=1`);
        return r.totals ? { tokens: r.totals.tokens ?? 0, costUsd: r.totals.costUsd ?? 0 } : null;
      } catch {
        return null;
      }
    },
  };
}

export type EvalClient = ReturnType<typeof createClient>;
