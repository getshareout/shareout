/**
 * Canvas-piloting tools for the web home agent. These don't return data for the
 * model to reason over — they push UI actions through the reply port so the agent
 * literally drives the user's screen (renders search results, opens an artifact).
 * Only the web home reply port implements sendUiAction / sendArtifactCards as
 * canvas mutations; on other platforms these degrade to plain card/text output.
 */
import type { AccountTool } from './types';
import { listArtifactsForUser } from './artifacts';
import { recordRecentView } from '../../pages/home/queries';
import { semanticSearchArtifacts } from '../../search/semantic';

/** Show matching pages in the user's main canvas (renders cards there). */
export const showArtifactsTool: AccountTool = {
  name: 'show_artifacts',
  description:
    "Display the user's matching pages in their main canvas as a grid of cards. Use this whenever they ask to see, find, browse, or pull up pages (e.g. \"show me CPM artifacts\"). Pass a query to filter by name/slug, or omit it to show recent pages. The cards render on screen — you don't need to list them in text; just confirm briefly.",
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Optional text to match in page name or slug.' } },
  },
  async execute(ctx, input) {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    // Semantic search (by meaning) when there's a query and the index is live;
    // otherwise (no query, or Vectorize/AI unavailable) keyword search.
    const semantic = query
      ? await semanticSearchArtifacts(ctx.env, ctx.userId, query, { workspaceId: ctx.selectedWorkspaceId, limit: 24 })
      : null;
    const items = semantic ?? await listArtifactsForUser(ctx.env, ctx.userId, {
      search: query || undefined,
      limit: 24,
      workspaceId: ctx.selectedWorkspaceId,
    });
    if (ctx.reply?.sendArtifactCards) await ctx.reply.sendArtifactCards(items);
    if (ctx.reply?.sendUiAction) await ctx.reply.sendUiAction({ kind: 'render_search', query });
    return { shown: items.length, query: query || null, names: items.slice(0, 10).map((a) => a.name) };
  },
};

/** Open a single page in the canvas stage. */
export const openArtifactTool: AccountTool = {
  name: 'open_artifact',
  description:
    "Open one page in the user's canvas so they can see it right there. Use the page id from show_artifacts/search_artifacts/list_artifacts. Confirm briefly after.",
  input_schema: {
    type: 'object',
    properties: { artifact_id: { type: 'string', description: 'The id of the page to open.' } },
    required: ['artifact_id'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    if (!artifactId) return { error: 'Missing artifact_id.' };
    const items = await listArtifactsForUser(ctx.env, ctx.userId, { limit: 200, workspaceId: ctx.selectedWorkspaceId });
    const found = items.find((a) => a.id === artifactId);
    if (!found) return { error: 'That page is not in your accessible set.' };
    await recordRecentView(ctx.env, ctx.userId, found.id).catch(() => {});
    if (ctx.reply?.sendUiAction) {
      await ctx.reply.sendUiAction({ kind: 'open_artifact', artifactId: found.id, slug: found.slug, name: found.name });
    }
    return { opened: found.name };
  },
};

/** Surface the setup checklist in the dock (work/033). Call when a new user asks how
 * to get started or seems stuck — the client re-derives live status and renders the
 * checklist with real action buttons. Don't volunteer it on unrelated turns. */
export const showOnboardingTool: AccountTool = {
  name: 'show_onboarding',
  description:
    "Show the user's setup checklist in the dock. Use ONLY when the user asks how to get started, what to set up, or seems stuck onboarding — not on unrelated questions. The checklist renders on screen with buttons (connect Telegram, connect data, etc.), so just confirm briefly and point at the next step.",
  input_schema: { type: 'object', properties: {} },
  async execute(ctx) {
    if (ctx.reply?.sendUiAction) await ctx.reply.sendUiAction({ kind: 'show_onboarding' });
    return { shown: true };
  },
};

export const CANVAS_TOOLS: AccountTool[] = [showArtifactsTool, openArtifactTool, showOnboardingTool];
