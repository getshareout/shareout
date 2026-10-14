// @vitest-environment happy-dom
//
// Studio inline Markdown editing: md → rendered blocks → (edit) → md.
// Untouched documents must come back byte-for-byte; every block the serializer
// accepts as editable must re-serialize to Markdown that renders identically.
import { describe, expect, it } from 'vitest';
import { markdownEditPayload, markdownEditShell, splitMarkdownBlocks, isHtmlDocument } from '../../../src/editor/markdown-edit';
import { parseMarkdown } from '../../../src/viewers/markdown-viewer';
import { workspace_client_md_edit_JS as mdJs } from '../../../src/pages/home/render-workspace/client-script/md-edit';

type Block = { src: string; sep: string; html: string; hidden?: boolean; lock?: boolean; orig?: string };
type Model = { lead: string; indent: string; blocks: Block[] };
interface MdApi {
  mdBuild(doc: Document, m: Model): void;
  mdPrepare(doc: Document, m: Model): number;
  mdFromDoc(doc: Document, m: Model): string;
  mdRoot(doc: Document): Element;
}
const api = new Function(`${mdJs}; return { mdBuild, mdPrepare, mdFromDoc, mdRoot };`)() as MdApi;

function open(md: string) {
  const m = markdownEditPayload(md) as Model;
  const doc = new DOMParser().parseFromString(markdownEditShell().replace(/<link[^>]*>/g, ''), 'text/html');
  api.mdBuild(doc, m);
  const locked = api.mdPrepare(doc, m);
  return { m, doc, locked, root: api.mdRoot(doc), save: () => api.mdFromDoc(doc, m) };
}

// Whitespace next to tags never changes what the reader sees (trailing spaces, gaps).
const squash = (html: string) => html.replace(/\s+</g, '<').replace(/>\s+/g, '>');

const FIXTURES: Record<string, string> = {
  headings: '# Title\n\nIntro paragraph.\n\n## Section\n\nBody text.\n\n### Small\n\nMore.\n',
  inline: 'Some **bold**, *italic*, ***both***, ~~gone~~ and `code` here.\n\nA [link](https://example.com) and ![alt text](https://example.com/a.png).\n',
  code: 'Before.\n\n```js\nconst a = 1;\n\nconsole.log(a);\n```\n\nAfter.\n',
  lists: '- one\n- two\n- three\n\n1. first\n2. second\n3. third\n',
  nested: '- top\n  - child\n    - grandchild\n  - child two\n- top two\n\n1. step\n  1. sub step\n2. next\n',
  tasks: '- [x] done\n- [ ] todo\n',
  quote: '> quoted line\n> second line\n\nAfter quote.\n',
  table: '| Name | Qty |\n| --- | --- |\n| Apples | 3 |\n| Pears | 5 |\n',
  hr: 'Above\n\n---\n\nBelow\n',
  frontmatter: '---\ntitle: Doc\ntags: [a]\n---\n# Heading\n\nText.\n',
  headingThenText: '# Title\nline right under it\n\nNext para.\n',
  crlfAndSpacing: '\n\n# Lead blanks\n\n\n\nWide gap above.   \n',
  noTrailingNewline: '# One\n\nTwo',
  starBullets: '* alpha\n* beta\n',
};

describe('splitMarkdownBlocks', () => {
  it('reconstructs every fixture exactly from lead + blocks', () => {
    for (const md of Object.values(FIXTURES)) {
      const { lead, blocks } = splitMarkdownBlocks(md);
      expect(lead + blocks.map((b) => b.src + b.sep).join('')).toBe(md);
    }
  });

  it('keeps a fenced code block with blank lines in one block', () => {
    const { blocks } = splitMarkdownBlocks(FIXTURES.code);
    expect(blocks.map((b) => b.src)).toEqual(['Before.', '```js\nconst a = 1;\n\nconsole.log(a);\n```', 'After.']);
  });

  it('marks front matter hidden', () => {
    const { blocks } = splitMarkdownBlocks(FIXTURES.frontmatter);
    expect(blocks[0]).toMatchObject({ src: '---\ntitle: Doc\ntags: [a]\n---', hidden: true });
  });

  it('spots an HTML draft left by the old Edit-Lite', () => {
    expect(isHtmlDocument('<!DOCTYPE html><html><body><p># x</p></body></html>')).toBe(true);
    expect(isHtmlDocument('# Title\n\n<b>inline html</b>')).toBe(false);
  });
});

describe('markdown round-trip (md → html → md)', () => {
  it('returns an untouched document byte-for-byte', () => {
    for (const [name, md] of Object.entries(FIXTURES)) {
      expect(open(md).save(), name).toBe(md);
    }
  });

  it('renders the edit surface with the viewer parser', () => {
    const { root } = open(FIXTURES.headings);
    expect(root.querySelector('h1')!.textContent).toBe('Title');
    expect(root.querySelectorAll('[data-md-b]').length).toBe(6);
  });

  it('re-serializes every editable block to Markdown that renders the same', () => {
    for (const [name, md] of Object.entries(FIXTURES)) {
      const { m, doc } = open(md);
      // Force every editable block through the serializer (as if each were edited).
      m.blocks.forEach((b) => { if (!b.hidden && !b.lock) b.orig = '\u0000changed'; });
      const out = api.mdFromDoc(doc, m);
      expect(squash(parseMarkdown(out)), name).toBe(squash(parseMarkdown(md)));
    }
  });

  it('keeps the constructs the renderer emits editable', () => {
    for (const name of ['headings', 'inline', 'code', 'lists', 'nested', 'tasks', 'quote', 'table', 'hr', 'headingThenText', 'starBullets']) {
      expect(open(FIXTURES[name]).locked, name).toBe(0);
    }
  });

  it('locks a list whose indentation differs from the rest of the document', () => {
    const md = '- a\n  - b\n\n1. x\n   1. y\n';
    const { locked, root, save } = open(md);
    expect(locked).toBe(1);
    expect(root.querySelector('ol')!.hasAttribute('data-md-lock')).toBe(true);
    root.querySelectorAll('li')[1].textContent = 'B';
    expect(save()).toBe('- a\n  - B\n\n1. x\n   1. y\n');
  });

  it('locks a block the serializer cannot reproduce instead of rewriting it', () => {
    const md = '| a | b |\n|:--|--:|\n| 1 | 2 |\n\nPara.\n';
    const { root, locked, save } = open(md);
    expect(locked).toBe(1);
    expect(root.querySelector('table')!.hasAttribute('data-md-lock')).toBe(true);
    root.querySelector('p')!.textContent = 'Edited.';
    expect(save()).toBe('| a | b |\n|:--|--:|\n| 1 | 2 |\n\nEdited.\n');
  });
});

describe('editing', () => {
  it('rewrites only the edited block', () => {
    const md = '# Title\n\nKeep   *this*   spacing.\n\nChange me.\n';
    const { root, save } = open(md);
    root.querySelectorAll('p')[1].innerHTML = 'Changed with <b>bold</b> and <i>italic</i>.';
    expect(save()).toBe('# Title\n\nKeep   *this*   spacing.\n\nChanged with **bold** and *italic*.\n');
  });

  it('edits a list item, a table cell and a heading', () => {
    const { root, save } = open('## Old\n\n1. a\n2. b\n\n| H |\n| --- |\n| x |\n');
    root.querySelector('h2')!.textContent = 'New';
    root.querySelectorAll('li')[1].textContent = 'B!';
    root.querySelector('td')!.innerHTML = '<a href="https://x.dev">y</a>';
    expect(save()).toBe('## New\n\n1. a\n2. B!\n\n| H |\n| --- |\n| [y](https://x.dev) |\n');
  });

  it('serializes inserted, moved and deleted blocks', () => {
    const { doc, root, save } = open('# A\n\nOne.\n\nTwo.\n');
    const [one, two] = Array.from(root.querySelectorAll('p'));
    root.insertBefore(two, one);
    const hr = doc.createElement('hr'); root.appendChild(hr);
    const p = doc.createElement('p'); p.textContent = 'New text'; root.appendChild(p);
    root.querySelector('h1')!.remove();
    expect(save()).toBe('Two.\n\nOne.\n\n---\n\nNew text\n');
  });

  it('keeps front matter when the body is edited', () => {
    const { root, save } = open(FIXTURES.frontmatter);
    root.querySelector('p')!.textContent = 'Changed.';
    expect(save()).toBe('---\ntitle: Doc\ntags: [a]\n---\n# Heading\n\nChanged.\n');
  });

  it('turns contenteditable non-breaking spaces into plain spaces', () => {
    const { root, save } = open('Hello world.\n');
    root.querySelector('p')!.innerHTML = 'Hello&nbsp;there.';
    expect(save()).toBe('Hello there.\n');
  });
});

describe('viewer list rendering', () => {
  it('renders ordered, nested and task lists', () => {
    expect(parseMarkdown('1. a\n2. b\n')).toContain('<ol><li>a</li><li>b</li></ol>');
    expect(parseMarkdown('3. c\n')).toContain('<ol start="3"><li>c</li></ol>');
    expect(parseMarkdown('- a\n  - b\n- c\n')).toContain('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
    expect(parseMarkdown('- [x] d\n- [ ] e\n')).toContain('<li class="task-list-item"><input type="checkbox" checked disabled> d</li>');
  });
});
