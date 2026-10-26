// @vitest-environment happy-dom
//
// Markdown links stay inside their href: quotes in a URL or link text never end the
// attribute, only http(s) / mailto / relative targets become links, and the shell's
// escaper and the Knowledge wiki-link pass keep attribute values intact.
import { describe, expect, it } from 'vitest';
import { workspace_client_agent_format_JS as formatJs } from '../../../src/pages/home/render-workspace/client-script/agent-format';
import { workspace_client_preamble_JS as preambleJs } from '../../../src/pages/home/render-workspace/client-script/preamble';
import { workspace_client_home_views_knowledge_JS as knowledgeJs } from '../../../src/pages/home/render-workspace/client-script/home-views/knowledge';
import { WORKSPACE_CLIENT } from '../../../src/pages/home/render-workspace/client-script';
import { RUN_DRAWER_JS } from '../../../src/runs/run-drawer-client';
import { renderMarkdown } from '../../../chat-core/src/markdown';
import { renderSkillHtml } from '../../../src/skills/render';
import { parseMarkdown } from '../../../src/viewers/markdown-viewer';
import { generateSourceEditorPage } from '../../../src/editor/source/page';

const mdToHtml = new Function(`${formatJs}\nreturn mdToHtml;`)() as (md: string) => string;

const between = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
const escLine = between(preambleJs, 'function esc(', '\n');
const esc = new Function(`${escLine}\nreturn esc;`)() as (s: unknown) => string;

function dom(html: string): DocumentFragment {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content;
}

/** What a browser would act on: event-handler attributes, scripts, and non-allowlisted URL schemes. */
function active(html: string): string[] {
  const found: string[] = [];
  for (const el of dom(html).querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (['script', 'iframe', 'object', 'embed', 'svg', 'math', 'style', 'base', 'form', 'meta', 'link'].includes(tag)) found.push(`<${tag}>`);
    for (const name of el.getAttributeNames()) {
      if (name.startsWith('on') || ['style', 'srcdoc', 'formaction'].includes(name)) found.push(`${tag}[${name}]`);
      if (name === 'href' || name === 'src') {
        const v = (el.getAttribute(name) || '').replace(/[\u0000- \u007f]/g, '');
        const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v)?.[1]?.toLowerCase();
        if (scheme && !['http', 'https', 'mailto'].includes(scheme)) found.push(`${tag}[${name}=${v}]`);
      }
    }
  }
  return found;
}

const QUOTED = [
  '[x](https://a"onmouseover="alert(1))',
  '[x](https://a"onmouseover="alert`1`")',
  "[x](https://a'onmouseover='alert`1`')",
  'see https://a"onfocus="alert`1`"autofocus="',
  "see https://a'onfocus='alert`1`'autofocus='",
  '![x](https://a"onerror="alert(1))',
];
const SCHEMES = [
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x](java\u0001script:alert(1))',
  '[x](&#106;avascript:alert(1))',
  '[x](&#x6A;avascript:alert(1))',
  '[x](&#0000106avascript:alert(1))',
  '[x](javascript&colon;alert(1))',
  '[x](java&Tab;script:alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[x](vbscript:msgbox(1))',
];

describe('home markdown links (agent dock, Catalog, Knowledge)', () => {
  it('keeps a quoted URL inside href: the link carries only href, target and rel', () => {
    for (const md of QUOTED) {
      const links = [...dom(mdToHtml(md)).querySelectorAll('a')];
      expect(links, md).toHaveLength(1);
      expect(links[0].getAttributeNames(), md).toEqual(['href', 'target', 'rel']);
    }
    expect(dom(mdToHtml(QUOTED[1])).querySelector('a')!.getAttribute('href')).toBe('https://a"onmouseover="alert`1`"');
    expect(dom(mdToHtml(QUOTED[3])).querySelector('a')!.getAttribute('href')).toBe('https://a"onfocus="alert`1`"autofocus="');
  });

  it('escapes quotes in link text and URLs', () => {
    expect(mdToHtml(`[a "b" 'c'](https://x.test/?q="1"&r='2')`)).toBe(
      '<p><a href="https://x.test/?q=&quot;1&quot;&amp;r=&#39;2&#39;" target="_blank" rel="noopener noreferrer">a &quot;b&quot; &#39;c&#39;</a></p>'
    );
    expect(mdToHtml(`He said "hi" & it's <fine>`)).toBe('<p>He said &quot;hi&quot; &amp; it&#39;s &lt;fine&gt;</p>');
  });

  it('leaves javascript:, data: and vbscript: targets as plain text', () => {
    for (const md of SCHEMES) {
      const frag = dom(mdToHtml(md));
      expect(frag.querySelector('a'), md).toBeNull();
      expect(frag.textContent, md).toContain('[x](');
    }
  });

  it('renders normal links as before, plus mailto and relative targets', () => {
    expect(mdToHtml('[docs](https://x.test/a?b=1&c=2)')).toBe(
      '<p><a href="https://x.test/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a></p>'
    );
    expect(mdToHtml('see https://x.test/a now')).toBe(
      '<p>see <a href="https://x.test/a" target="_blank" rel="noopener noreferrer">https://x.test/a</a> now</p>'
    );
    expect(mdToHtml('**[bold](https://x.test)** and *[em](https://y.test)*')).toBe(
      '<p><strong><a href="https://x.test" target="_blank" rel="noopener noreferrer">bold</a></strong> and <em><a href="https://y.test" target="_blank" rel="noopener noreferrer">em</a></em></p>'
    );
    expect(mdToHtml('[**b** `c`](https://x.test)')).toBe(
      '<p><a href="https://x.test" target="_blank" rel="noopener noreferrer"><strong>b</strong> <code>c</code></a></p>'
    );
    const rel = dom(mdToHtml('[page](/a/q3/) [top](#top) [mail](mailto:a@x.test)'));
    expect([...rel.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/a/q3/', '#top', 'mailto:a@x.test']);
  });

  it('keeps code spans literal, links included', () => {
    expect(mdToHtml('run `[x](https://x.test) <b>`')).toBe('<p>run <code>[x](https://x.test) &lt;b&gt;</code></p>');
  });
});

describe('home shell escaper', () => {
  it('is declared once in the shell and escapes quotes for attribute values', () => {
    const shell = WORKSPACE_CLIENT.slice(0, WORKSPACE_CLIENT.length - RUN_DRAWER_JS.length);
    expect(shell.match(/function esc\(/g)).toHaveLength(1);
    expect(esc(`a"b'c<d>&`)).toBe('a&quot;b&#39;c&lt;d&gt;&amp;');
    expect(esc(null)).toBe('');
    const el = dom(`<span data-cat-id="${esc('x" onmouseover="y')}" title='${esc("a' onclick='b")}'></span>`).querySelector('span')!;
    expect(el.getAttributeNames()).toEqual(['data-cat-id', 'title']);
    expect(el.getAttribute('data-cat-id')).toBe('x" onmouseover="y');
    expect(el.getAttribute('title')).toBe("a' onclick='b");
  });
});

describe('Knowledge wiki links', () => {
  const knState = {
    nodes: [
      { id: 'topic.revenue', path: 'topics/revenue.md', title: 'Revenue' },
      { id: 'topic.quoted', path: 'topics/q"x.md', title: 'Q "x"' },
    ],
    byPath: {},
  };
  const knWikiLinks = new Function('knState', 'esc', `${between(knowledgeJs, 'function knWikiNode', 'function knBindWikiLinks')}\nreturn knWikiLinks;`)(knState, esc) as (html: string) => string;

  it('turns [[id]] in text into a button and leaves one inside a link URL alone', () => {
    const frag = dom(knWikiLinks(mdToHtml('See [[topic.revenue]] and [[topic.quoted]] or [x](https://x.test/[[topic.revenue]])')));
    const a = frag.querySelector('a')!;
    expect(a.getAttributeNames()).toEqual(['href', 'target', 'rel']);
    expect(a.getAttribute('href')).toBe('https://x.test/[[topic.revenue]]');
    const buttons = [...frag.querySelectorAll('button.wsx-kn2__wl')];
    expect(buttons.map((b) => b.getAttribute('data-kn-go'))).toEqual(['topics/revenue.md', 'topics/q"x.md']);
    expect(buttons.map((b) => b.textContent)).toEqual(['Revenue', 'Q "x"']);
    expect(buttons.every((b) => b.getAttributeNames().join() === 'type,class,data-kn-go')).toBe(true);
  });
});

describe('every markdown renderer keeps links inside their attribute', () => {
  const page = generateSourceEditorPage({
    artifactId: 'a', slug: 's', name: 'n', type: 'markdown', entrypoint: 'index.md', path: null,
    content: '', baseUrl: 'https://so.test', versionNo: 1,
  });
  const previewCode = between(page, 'function escHtml', '/* ---------- csv grid');
  const sourcePreview = new Function(`${previewCode}\nreturn function (md) { return safeHtml(mdToHtml(md)); };`)() as (md: string) => string;

  const renderers: Array<[string, (md: string) => string]> = [
    ['home (agent dock, Catalog, Knowledge)', mdToHtml],
    ['chat-core (SDK agent widget)', renderMarkdown],
    ['skills (Library)', renderSkillHtml],
    ['markdown viewer (artifacts)', parseMarkdown],
    ['source editor preview', sourcePreview],
  ];

  for (const [name, render] of renderers) {
    it(name, () => {
      for (const md of [...QUOTED, ...SCHEMES, 'x <img src=x onerror=alert(1)> [[topic.a]]']) {
        expect(active(render(md)), `${name}: ${md}`).toEqual([]);
      }
      expect(dom(render('[ok](https://x.test/a)')).querySelector('a')?.getAttribute('href'), name).toBe('https://x.test/a');
    });
  }
});
