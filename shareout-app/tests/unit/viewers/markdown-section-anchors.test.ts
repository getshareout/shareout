// G18: Knowledge citations deep-link with ?section=<anchor> where anchor comes from headingAnchors()
// (the corpus chunker's slug). The markdown viewer must emit that same id and scroll to it.
import { describe, expect, it } from 'vitest';
import { parseMarkdown, renderMarkdownViewer } from '../../../src/viewers/markdown-viewer';
import { headingAnchors } from '../../../src/serve/heading-anchors';

const MD = '# Manual\n\n## 3.2 Clasificación de residuos\n\ntexto\n\n## Gestión\n\n## Gestión\n';

describe('markdown viewer section anchors', () => {
  it('emits an element with the SAME id headingAnchors gives each heading (numbered across the page)', () => {
    const html = parseMarkdown(MD);
    const anchors = headingAnchors(['Manual', '3.2 Clasificación de residuos', 'Gestión', 'Gestión']);
    expect(anchors).toEqual(['h-manual', 'h-3-2-clasificacion-de-residuos', 'h-gestion', 'h-gestion-2']);
    for (const a of anchors) expect(html).toContain(`id="${a}"`);
  });

  it('keeps the existing heading ids (table-of-contents links still work)', () => {
    const html = parseMarkdown('## Hello World\n');
    expect(html).toContain('<h2 id="hello-world">');
    expect(html).toContain('id="h-hello-world"');
  });

  it('does not number headings that sit inside code blocks', () => {
    const html = parseMarkdown('```\n# not a heading\n```\n\n## Real\n');
    expect(html).toContain('id="h-real"');
    expect(html).not.toContain('h-not-a-heading');
  });

  it('the viewer page scrolls to ?section= and highlights the heading', () => {
    const page = renderMarkdownViewer({
      slug: 's', artifactName: 'n', artifactType: 'markdown', typeMetadata: {}, baseUrl: 'https://x', content: MD,
      isAdmin: false, artifactId: 'a', loggedIn: false, isFavorite: false, nonce: 'abc',
    } as never);
    expect(page).toContain("get('section')");
    expect(page).toContain('scrollIntoView');
    expect(page).toContain('<script nonce="abc">');
  });
});
