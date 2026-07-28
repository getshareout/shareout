// Executes agent "tool actions" — the agent operating the editor, not just patching HTML
import type { EditorContext } from '../editor/context';
import { createLogger } from '../editor/logger';
import { resolveElementBySelector } from '../dom/editor-ids';
import { syncHtmlFromCanvas } from '../history/html-sync';
import { markDirty } from '../persistence/draft';
import { setRailMode } from '../rail/rail';

const log = createLogger('agent-actions');

export interface AgentAction {
  type: 'bindData' | 'createJsonKey' | 'openTab' | 'select';
  label?: string;
  selector?: string;
  key?: string;
  value?: unknown;
  tab?: 'agent' | 'inspect' | 'data';
}

/** Friendly label for a step (falls back to a generated one). */
export function actionLabel(a: AgentAction): string {
  if (a.label) return a.label;
  switch (a.type) {
    case 'createJsonKey': return `Create data "${a.key}"`;
    case 'bindData': return `Connect ${a.selector || 'element'} to "${a.key}"`;
    case 'openTab': return `Open ${a.tab} panel`;
    case 'select': return `Select ${a.selector}`;
    default: return 'Step';
  }
}

/** Run actions in order, reporting status per step so the UI can show plan→doing→done. */
export async function executeAgentActions(
  ctx: EditorContext,
  actions: AgentAction[],
  onStep?: (index: number, status: 'doing' | 'done' | 'error') => void
): Promise<void> {
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    onStep?.(i, 'doing');
    try {
      await runAction(ctx, a);
      onStep?.(i, 'done');
    } catch (err) {
      log.error('action failed', { action: a, err });
      onStep?.(i, 'error');
    }
  }
}

async function runAction(ctx: EditorContext, a: AgentAction): Promise<void> {
  const doc = ctx.dom.canvasFrame?.contentDocument;

  switch (a.type) {
    case 'createJsonKey': {
      if (!a.key) return;
      await fetch(`/v1/artifacts/${ctx.config.artifactId}/editor/sdk/json/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ key: a.key, value: a.value ?? '' }),
      });
      return;
    }

    case 'bindData': {
      if (!doc || !a.selector || !a.key) return;
      const el = resolveElementBySelector(doc, a.selector);
      if (!el) throw new Error(`bindData: ${a.selector} not found`);
      el.setAttribute('data-key', a.key);
      syncHtmlFromCanvas(ctx);
      markDirty(ctx);
      return;
    }

    case 'openTab': {
      if (a.tab) setRailMode(ctx, a.tab);
      return;
    }

    case 'select': {
      if (!doc || !a.selector) return;
      const el = resolveElementBySelector(doc, a.selector);
      if (el) {
        (ctx as { selectElement?: (e: Element) => void }).selectElement?.(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
  }
}
