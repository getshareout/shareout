import type { FetchContext } from '../context';
import { getSessionUser } from '../../auth';
import { chat, streamChat, getAgentChatModel, getBuildConfig } from '../../data/agent/anthropic';
import { BUILD_MAX_TOKENS, buildSystemPrompt, extractHtml, deriveName } from '../../data/agent/build-page';
import { getPackDirective } from '../../pages/themes';
import { publishGeneratedHtml } from '../../publish';
import { checkSlidingWindowRateLimit, getClientIp } from '../../rate-limit';
import { createLogger, logError } from '../../logging';
import { requireCreateEnabled } from '../../pages/create-gate';
import { hostWorkspaceId } from '../../pages/home/host';
import { jsonWithApiErrors } from '../../http/api-error';

// The builder runs on a stronger model and produces a full document — give it room.
// It streams (see chatComplete), so a slow full-page generation isn't bound by a read timeout.
// Capped to keep worst-case latency reasonable; most pages stop naturally well under this.
const PLANNER_SYSTEM_PROMPT = `You are the router for ShareOut's build agent. Read the user's request and decide how to respond. Reply with ONLY a JSON object — no prose, no markdown, no code fences.

Schema:
{
  "mode": "build" | "reply" | "confirm" | "clarify",
  "message": string,          // one or two warm, plain sentences. No HTML, no markdown.
  "suggestions": string[],    // 0-3 short next-step prompts the user could tap. Imperative, under 6 words.
  "confirm": {                // include ONLY when mode is "confirm"
    "label": string,          // confirm button text, e.g. "Replace the page"
    "prompt": string          // the exact build instruction to run if the user confirms
  },
  "questions": [              // include ONLY when mode is "clarify". 1-2 items.
    {
      "q": string,            // a short design question, under 8 words
      "options": string[]     // 2-4 short tappable answers, each under 4 words
    }
  ]
}

How to choose mode:
- "clarify" (use this for the FIRST build of a brand-new page, when no page exists yet): ask 1-2 quick questions that meaningfully shape the design — audience/tone/vibe/scope. Keep them concrete and tappable. message = a brief, warm lead-in like "Quick — two things and I'll build it." Do NOT clarify for small edits to an existing page.
- "build": the user wants to create the page or make an incremental change to an existing one. message = a brief "on it" line.
- "reply": the user asked a question, said thanks, or is chatting — nothing to build. message = your answer.
- "confirm": the request is significant or hard to undo, so check first. Use it when: a page already exists and the user wants to replace or rewrite the WHOLE thing into something unrelated (not a small edit); the user wants to delete data; or the user wants to connect an external data source they must authorize (Google Sheets, Analytics, Shopify). Put the build instruction in confirm.prompt.

Keep message short, friendly, and concrete. Tailor questions and suggestions to the user's request and the current page.`;

interface PlanEnvelope {
  mode?: 'build' | 'reply' | 'confirm' | 'clarify';
  message?: string;
  suggestions?: unknown;
  confirm?: { label?: string; prompt?: string };
  questions?: unknown;
}

function parsePlan(raw: string): PlanEnvelope {
  let s = (raw || '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const obj = JSON.parse(s) as PlanEnvelope;
    if (obj && (obj.mode === 'build' || obj.mode === 'reply' || obj.mode === 'confirm' || obj.mode === 'clarify')) return obj;
  } catch {
    // Fall through to the safe default below.
  }
  return { mode: 'build' };
}

function sanitizeSuggestions(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .slice(0, 3)
    .map((s) => s.trim().slice(0, 60));
}

interface ClarifyQuestion {
  q: string;
  options: string[];
}

function sanitizeQuestions(list: unknown): ClarifyQuestion[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((item): ClarifyQuestion | null => {
      if (!item || typeof item !== 'object') return null;
      const q = (item as { q?: unknown }).q;
      const opts = (item as { options?: unknown }).options;
      if (typeof q !== 'string' || !q.trim() || !Array.isArray(opts)) return null;
      const options = opts
        .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
        .slice(0, 4)
        .map((o) => o.trim().slice(0, 32));
      if (options.length < 2) return null;
      return { q: q.trim().slice(0, 80), options };
    })
    .filter((x): x is ClarifyQuestion => x !== null)
    .slice(0, 2);
}

function detectCapabilities(html: string): string[] {
  if (!/shareout\.js|new ShareOut/i.test(html)) return [];
  const caps: string[] = [];
  if (/\.table\s*\(/.test(html)) caps.push('Structured data');
  if (/\.realtime\s*\(/.test(html)) caps.push('Realtime');
  if (/\.blobs/.test(html)) caps.push('File uploads');
  if (/\.agent/.test(html)) caps.push('AI chat');
  if (caps.length === 0) caps.push('Saves data');
  return caps.slice(0, 4);
}

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

type Env = FetchContext['env'];
type SessionUser = { id: string; email: string };

export async function routeCreateApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;
  if (path !== '/v1/create/generate' || request.method !== 'POST') return null;

  const hostWs = await hostWorkspaceId(request, env);
  const blocked = await requireCreateEnabled(env, hostWs);
  if (blocked) return addCORS(blocked);

  const user = await getSessionUser(request, env);

  let body: { phase?: string; prompt?: string; slug?: string; html?: string; theme?: string };
  try {
    body = await request.json();
  } catch {
    return addCORS(json({ ok: false, error: 'Invalid request.' }, 400));
  }

  const prompt = (body.prompt || '').toString().trim().slice(0, 2000);
  if (!prompt) return addCORS(json({ ok: false, error: 'Tell me what to build.' }, 400));

  const previousHtml = typeof body.html === 'string' ? body.html.slice(0, 200000) : '';
  const slug = typeof body.slug === 'string' && body.slug ? body.slug : undefined;
  const theme = typeof body.theme === 'string' ? body.theme.slice(0, 60) : undefined;

  // Planning routes the request — safe for anonymous visitors.
  if (body.phase === 'plan') {
    return addCORS(await handlePlan(env, prompt, !!previousHtml));
  }

  // Preview generates the page WITHOUT publishing — the CRO "watch it build"
  // moment. Anonymous visitors are allowed but rate-limited per IP.
  if (body.phase === 'preview') {
    if (!user) {
      const ip = getClientIp(request);
      const rl = await checkSlidingWindowRateLimit(env.RATE_LIMIT_KV, ip, 'createPreviewAnon');
      if (!rl.allowed) {
        return addCORS(
          json(
            { ok: false, error: 'You’ve previewed a few already — create a free account to keep building.', code: 'PREVIEW_LIMIT' },
            429
          )
        );
      }
    }
    return addCORS(streamGenerate({ env, prompt, previousHtml, theme }));
  }

  // Publishing (build / publish) writes to the account — requires auth.
  if (!user) {
    return addCORS(json({ ok: false, error: 'Create a free account to save & publish.', code: 'UNAUTHENTICATED' }, 401));
  }

  // Publish the exact HTML the visitor already previewed (no regeneration).
  if (body.phase === 'publish' && previousHtml) {
    return addCORS(await handlePublish(env, user, prompt, previousHtml, slug));
  }

  return addCORS(streamGenerate({ env, prompt, previousHtml, theme, publish: { user, slug } }));
}

function sseLine(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

// Stream the build token-by-token over SSE so the client can render the page as it's written,
// then finalize: publish (build phase) or just return the HTML (preview phase). Generation streams
// at first byte, so the slow full-page build shows live instead of blocking behind a spinner.
function streamGenerate(opts: {
  env: Env;
  prompt: string;
  previousHtml: string;
  theme?: string;
  publish?: { user: SessionUser; slug?: string };
}): Response {
  const { env, prompt, previousHtml, theme, publish } = opts;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(sseLine(obj)));
      try {
        const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        if (previousHtml) {
          messages.push({ role: 'user', content: `Here is the current page you built:\n\n${previousHtml}` });
          messages.push({ role: 'assistant', content: 'Got it — I have the current page.' });
        }
        const userPrompt = previousHtml ? prompt : `${prompt}\n\nDesign direction: ${getPackDirective(theme)}`;
        messages.push({ role: 'user', content: userPrompt });

        const systemPrompt = await buildSystemPrompt(env);
        let full = '';
        for await (const chunk of streamChat(env, messages, systemPrompt, '', BUILD_MAX_TOKENS, getBuildConfig(env))) {
          if (chunk.type === 'content' && chunk.content) {
            full += chunk.content;
            send({ type: 'delta', text: chunk.content });
          } else if (chunk.type === 'error') {
            send({ type: 'error', error: 'The builder hit a snag — try again.' });
            controller.close();
            return;
          }
        }

        const html = extractHtml(full);
        if (!html || html.length < 40) {
          send({ type: 'error', error: 'I couldn’t build that — try rephrasing.' });
          controller.close();
          return;
        }

        const capabilities = detectCapabilities(html);
        if (publish) {
          try {
            const published = await publishGeneratedHtml(env, publish.user, {
              name: deriveName(prompt),
              slug: publish.slug,
              html,
            });
            send({
              type: 'done',
              mode: 'build',
              html,
              url: published.deployment.url,
              slug: published.deployment.slug,
              artifactId: published.artifact.id,
              capabilities,
            });
          } catch {
            send({ type: 'error', error: 'Built it, but publishing failed. Try again.' });
          }
        } else {
          send({ type: 'done', mode: 'preview', html, capabilities });
        }
        controller.close();
      } catch {
        try {
          controller.enqueue(encoder.encode(sseLine({ type: 'error', error: 'Something went wrong — try again.' })));
        } catch {
          // Stream already closed.
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

// Publish HTML the user already previewed — persist it exactly as shown.
async function handlePublish(
  env: Env,
  user: SessionUser,
  prompt: string,
  html: string,
  slug: string | undefined
): Promise<Response> {
  let published;
  try {
    published = await publishGeneratedHtml(env, user, { name: deriveName(prompt), slug, html });
  } catch (err) {
    logError(createLogger(env, { scope: 'create', event: 'publish.failed' }), 'create publish failed', err);
    return json({ ok: false, error: 'Publishing failed. Try again.', code: 'INTERNAL_ERROR' }, 500);
  }
  return json({
    ok: true,
    type: 'build',
    html,
    url: published.deployment.url,
    slug: published.deployment.slug,
    artifactId: published.artifact.id,
    capabilities: detectCapabilities(html),
  });
}

// Phase 1: route the request to a reply, a confirmation, or a build.
async function handlePlan(env: Env, prompt: string, hasPage: boolean): Promise<Response> {
  const context = (hasPage ? 'The user already has a published page. ' : 'No page exists yet. ') + `Request: ${prompt}`;
  let raw = '';
  try {
    const res = await chat(env, [{ role: 'user', content: context }], PLANNER_SYSTEM_PROMPT, getAgentChatModel(env), 500);
    raw = res.content;
  } catch {
    // Planner unavailable — don't block; fall straight to building.
    return json({ ok: true, type: 'build', message: 'On it — building this now.', suggestions: [] });
  }

  const plan = parsePlan(raw);
  const suggestions = sanitizeSuggestions(plan.suggestions);
  const message = (plan.message || '').toString().slice(0, 400);

  if (plan.mode === 'clarify') {
    const questions = sanitizeQuestions(plan.questions);
    if (questions.length) {
      return json({ ok: true, type: 'clarify', message: message || 'Quick — a couple things first.', questions });
    }
    // No usable questions — don't stall the user; build.
    return json({ ok: true, type: 'build', message: message || 'On it — building this now.', suggestions });
  }
  if (plan.mode === 'reply') {
    return json({ ok: true, type: 'reply', message: message || 'Here you go.', suggestions });
  }
  if (plan.mode === 'confirm') {
    return json({
      ok: true,
      type: 'confirm',
      message: message || 'Want me to go ahead?',
      confirm: {
        label: (plan.confirm?.label || 'Confirm').toString().slice(0, 40),
        prompt: (plan.confirm?.prompt || prompt).toString().slice(0, 2000),
      },
      suggestions,
    });
  }
  return json({ ok: true, type: 'build', message: message || 'On it — building this now.', suggestions });
}

