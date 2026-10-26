/**
 * Tools for the build loop: publish → verify → fix. verify_artifact runs the same
 * check as POST /v1/artifacts/{id}/verify, as the caller (owners and editors only),
 * and answers with a short report plus what the page looks like on desktop and phone.
 */
import { bytesToBase64 } from '../pages/home/import-office';
import { agentSummary } from '../verify/report';
import { runVerify } from '../verify/service';
import type { Viewport } from '../verify/types';
import { VIEWPORT_NAMES } from '../verify/types';
import { fail, invalid, str, type ToolDef, type ToolResult } from './tool-kit';

const verifyArtifact: ToolDef = {
  name: 'verify_artifact',
  title: 'Check a page',
  description: [
    'Opens a published page the way the people it is shared with see it — on a desktop screen and on a phone — and reports what is broken:',
    'script errors (with file and line), files that fail to load, blocked libraries, accessibility problems, content wider than the phone screen,',
    'tap targets that are too small, slow loading, and common mistakes in the source. Returns a short report and two screenshots (desktop, then phone).',
    'Call it right after publish_artifact or update_artifact, fix what it reports, update the page and check again.',
    'artifact_id: the page. version: an older or newer version number (defaults to the live one). full_page: screenshot the whole page height.',
    'Only owners and editors of the page can check it.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      version: { type: 'integer', minimum: 1, description: 'Version number to check. Defaults to the live version.' },
      full_page: { type: 'boolean', default: false, description: 'Screenshot the whole page, not just the first screen.' },
    },
    required: ['artifact_id'],
    additionalProperties: false,
  },
  // Read-only for the agent: it changes nothing on the page (the run is kept as the page's
  // latest verify result), so clients can call it in a fix loop without asking each time.
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async run(ctx, args): Promise<ToolResult> {
    const id = str(args.artifact_id, 100);
    if (!id) return invalid('artifact_id is needed.');
    const outcome = await runVerify(ctx.env, ctx.user, id, {
      ...(typeof args.version === 'number' ? { version: args.version } : {}),
      fullPage: args.full_page === true,
      refreshThumbnail: false,
    });
    if (!outcome.ok) {
      const text = `The page was not checked: ${outcome.error}${outcome.hint ? ` ${outcome.hint}` : ''}`;
      return outcome.status >= 500 ? fail(text, { status: outcome.status, code: outcome.code }) : invalid(text);
    }
    const { result, shots } = outcome;
    const images = VIEWPORT_NAMES
      .filter((vp): vp is Viewport => !!shots[vp])
      .map((vp) => ({ type: 'image' as const, data: bytesToBase64(shots[vp]!), mimeType: 'image/webp' }));
    return {
      content: [{ type: 'text', text: agentSummary(result, outcome.name) }, ...images],
      structuredContent: {
        verify_id: result.id,
        status: result.status,
        version: result.version,
        live: result.live,
        counts: result.counts,
      },
    };
  },
};

export const BUILD_TOOLS: ToolDef[] = [verifyArtifact];
