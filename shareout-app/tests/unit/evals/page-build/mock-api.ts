/** A fake instance behind the eval client's fetch: no network, every call recorded. */
import type { FetchFn } from '../../../../evals/page-build/client';

export interface MockCall {
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
}

const sse = (events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export interface MockOptions {
  /** Files the build publishes, per artifact id. */
  files: (artifactId: string, nth: number) => Array<{ path: string; content: string }>;
  /** The assistant proposes nothing for prompts matching this. */
  noProposalFor?: RegExp;
  verifyBody?: unknown;
  verifyStatus?: number;
  failConfirmFor?: RegExp;
  /** Edit confirms change the seed page to these files. */
  editedFiles?: Array<{ path: string; content: string }>;
}

export function mockInstance(opts: MockOptions) {
  const calls: MockCall[] = [];
  const pending = new Map<string, { prompt: string; kind: 'build' | 'edit'; pageId?: string }>();
  const pages = new Map<string, Array<{ path: string; content: string }>>();
  let n = 0;
  let tokens = 0;

  const fetchFn: FetchFn = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const headers = init?.headers as Record<string, string>;
    calls.push({ method, path: url.pathname + url.search, auth: headers?.Authorization ?? null, body });
    const p = url.pathname;

    if (p === '/v1/publish') {
      const id = `art_seed${++n}`;
      pages.set(id, body.files);
      return json({ artifact: { id }, version: { version_no: 1 } }, 201);
    }
    if (/\/agent\/chat$/.test(p)) {
      const text: string = body.text;
      if (opts.noProposalFor?.test(text)) return sse([{ type: 'text', text: 'Which colours do you want?' }, { type: 'done' }]);
      const token = `appr_${++n}`;
      const pageId = text.match(/Page id: (\S+)\)/)?.[1];
      pending.set(token, { prompt: text, kind: pageId ? 'edit' : 'build', pageId });
      tokens += 1000;
      return sse([{ type: 'thread', id: 'thr_1', title: 't' }, { type: 'text', text: 'On it.' }, { type: 'confirm', prompt: 'Build?', token }, { type: 'done' }]);
    }
    if (/\/agent\/confirm$/.test(p)) {
      const rec = pending.get(body.token);
      if (!rec) return json({ error: 'That confirmation expired.' }, 410);
      tokens += 9000;
      if (rec.kind === 'edit') {
        pages.set(rec.pageId!, opts.editedFiles ?? pages.get(rec.pageId!)!);
        return json({ ok: true, text: 'Done.' });
      }
      if (opts.failConfirmFor?.test(rec.prompt)) return sse([{ type: 'build_step', label: 'Designing' }, { type: 'build_done', ok: false, text: 'It did not pass its own checks', name: 'x' }, { type: 'done' }]);
      const id = `art_build${++n}`;
      pages.set(id, opts.files(id, n));
      return sse([{ type: 'build_step', label: 'Designing' }, { type: 'build_step', label: 'Publishing' }, { type: 'build_done', ok: true, text: 'Published', artifactId: id, slug: 's', name: 'Page' }, { type: 'done' }]);
    }
    const files = p.match(/^\/v1\/artifacts\/([^/]+)\/files$/);
    if (files) {
      const f = pages.get(files[1]);
      if (!f) return json({ error: 'Artifact not found' }, 404);
      return json({ version_no: 1, files: f.map((x) => ({ ...x, encoding: 'utf8', mime: 'text/html' })) });
    }
    if (/\/verify$/.test(p)) return json(opts.verifyBody ?? { status: 'pass', counts: { error: 0, warning: 0 }, issues: [] }, opts.verifyStatus ?? 200);
    if (/\/tags$/.test(p)) return json({ tags: [] });
    if (method === 'DELETE' && p.startsWith('/v1/artifacts/')) return json({ success: true });
    if (/\/usage$/.test(p)) return json({ totals: { tokens, costUsd: tokens / 1_000_000 } });
    return json({ error: 'not found' }, 404);
  };

  return { fetch: fetchFn, calls, pages };
}
