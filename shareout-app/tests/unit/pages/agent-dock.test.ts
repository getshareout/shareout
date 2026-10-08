// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { workspace_client_agent_format_JS } from '../../../src/pages/home/render-workspace/client-script/agent-format';
import { workspace_client_agent_dock_JS } from '../../../src/pages/home/render-workspace/client-script/agent-dock';
import { workspace_client_agent_threads_JS } from '../../../src/pages/home/render-workspace/client-script/agent-threads';
import { workspace_client_onboarding_JS } from '../../../src/pages/home/render-workspace/client-script/onboarding';
import { HOME_COPY } from '../../../src/pages/home/home-i18n';
import { COMPOSER_COPY } from '../../../src/pages/home/home-i18n/copy/composer';
import { AGENT_COPY } from '../../../src/pages/home/home-i18n/copy/agent';
import { ONBOARDING_COPY } from '../../../src/pages/home/home-i18n/copy/onboarding';
import { buildWorkspaceView } from '../../../src/pages/home/render-workspace';
import type { RenderArgs } from '../../../src/pages/home/types';

type Fmt = {
  mdToHtml: (s: string) => string;
  mdStreaming: (s: string) => string;
  attachMarker: (name: string, id: string) => string;
  splitAttachments: (s: string) => { text: string; files: { name: string; id: string }[] };
};
const fmt = new Function(
  `${workspace_client_agent_format_JS}\nreturn { mdToHtml: mdToHtml, mdStreaming: mdStreaming, attachMarker: attachMarker, splitAttachments: splitAttachments };`
)() as Fmt;
const FENCE = '```';

describe('agent dock — text helpers', () => {
  it('renders safe markdown (escapes HTML, keeps lists and code)', () => {
    const html = fmt.mdToHtml('**Hi** <b>x</b>\n- one\n- two');
    expect(html).toContain('<strong>Hi</strong>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('<ul class="wsx-ul"><li>one</li><li>two</li></ul>');
  });

  it('closes a dangling code fence while streaming so code renders as code', () => {
    const partial = `Here:\n${FENCE}js\nconst a = 1;`;
    expect(fmt.mdToHtml(partial)).not.toContain('<pre');
    expect(fmt.mdToHtml(fmt.mdStreaming(partial))).toContain('<pre class="wsx-pre"><code>const a = 1;');
    const closed = `${FENCE}\nx\n${FENCE}`;
    expect(fmt.mdStreaming(closed)).toBe(closed);
  });

  it('round-trips the attachment marker: server text keeps it, the bubble shows a chip', () => {
    const marker = fmt.attachMarker('Q3 sales.xlsx', 'blob_123');
    expect(marker).toBe('[Attached file: Q3 sales.xlsx — file id blob_123]');
    const parts = fmt.splitAttachments(`Summarize this\n\n${marker}`);
    expect(parts.text).toBe('Summarize this');
    expect(parts.files).toEqual([{ name: 'Q3 sales.xlsx', id: 'blob_123' }]);
  });

  it('strips a marker-only message (attachment with no text) and odd names', () => {
    const parts = fmt.splitAttachments(fmt.attachMarker('a]b\nc.pdf', 'b9'));
    expect(parts.text).toBe('');
    expect(parts.files).toEqual([{ name: 'a b c.pdf', id: 'b9' }]);
    expect(fmt.splitAttachments('plain text').files).toEqual([]);
  });
});

describe('agent dock — copy', () => {
  const fragments = [workspace_client_agent_dock_JS, workspace_client_agent_threads_JS, workspace_client_onboarding_JS].join('\n');

  it('every literal t() key used by the chat exists in en and es', () => {
    const keys = new Set([...fragments.matchAll(/\b(?:t|addError)\('([a-zA-Z0-9_.]+)'[),]/g)].map((m) => m[1]));
    keys.add('agent.brief.morning').add('agent.brief.afternoon').add('agent.brief.evening');
    expect(keys.size).toBeGreaterThan(30);
    for (const k of keys) {
      expect(HOME_COPY.en[k], `en ${k}`).toBeTruthy();
      expect(HOME_COPY.es[k], `es ${k}`).toBeTruthy();
    }
  });

  it('has no hardcoded English UI strings left in the dock', () => {
    for (const s of ['Okay, cancelled', '\\u25A0 Stop', "'Stopped.'", 'Connection dropped', 'Preparing your', "'Reply ready'", "'Build it'", "'Approve'", "'You'", "'ShareOut'", 'window.prompt', 'window.confirm']) {
      expect(fragments, s).not.toContain(s);
    }
  });

  it('chat copy speaks es-AR (vos) and says "páginas", not "artefactos"', () => {
    for (const mod of [COMPOSER_COPY, AGENT_COPY, ONBOARDING_COPY]) {
      expect(Object.keys(mod.es).sort()).toEqual(Object.keys(mod.en).sort());
      for (const v of Object.values(mod.es)) {
        expect(v).not.toMatch(/\b(tú|tienes|quieres|puedes|muéstrame|Cuéntame|Pregunta a|Describe lo|Intenta)\b/);
        expect(v).not.toMatch(/artefacto/i);
      }
    }
    expect(ONBOARDING_COPY.es['onb.progress']).toBe('{done} de {total} listos');
  });
});

describe('agent dock — markup and behaviour contracts', () => {
  const args = {
    user: { id: 'u1', email: 'a@b.com' },
    userInfo: { name: 'Test', picture: null },
    workspaces: [],
    workspaceRole: 'owner',
    workspaceId: 'ws1',
    workspace: 'ws1',
  } as RenderArgs;
  const { body } = buildWorkspaceView(args);
  const composer = body.slice(body.indexOf('id="wsxComposer"'), body.indexOf('id="wsxHelpScrim"'));

  it('uses a textarea composer, a log region and a pinned jump button', () => {
    expect(composer).toMatch(/<textarea class="wsx__dockinput" id="wsxAsk"/);
    expect(composer).toContain('role="log"');
    expect(composer).toContain('id="wsxSend"');
    expect(composer).toContain('id="wsxPill"');
    // jump-to-latest sits outside the scroller so it doesn't scroll away
    const thread = composer.slice(composer.indexOf('id="wsxThread"'), composer.indexOf('id="wsxScrollDown"'));
    expect(thread).toContain('</div>\n      </div>');
    expect(composer).not.toContain('wsx__live-dot');
    expect(composer).not.toContain('M12 3l1.9 5.8'); // sparkle icon
  });

  it('never auto-opens the sheet on load (brief + onboarding mark the pill unread instead)', () => {
    const brief = workspace_client_agent_dock_JS.slice(workspace_client_agent_dock_JS.indexOf("var key = 'wsx_brief_'"));
    expect(brief).not.toMatch(/openDock\(\)|openComposer\(\)|setComposer\('sheet'\)/);
    expect(brief).toContain('markUnread()');
    const render = workspace_client_onboarding_JS.slice(
      workspace_client_onboarding_JS.indexOf('function renderOnb'),
      workspace_client_onboarding_JS.indexOf('function refreshOnb')
    );
    expect(render).not.toMatch(/openDock\(\)|openComposer\(\)/);
    expect(render).not.toContain("'role', 'status'");
  });
});
