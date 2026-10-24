// G18: Knowledge citations deep-link with ?section=<anchor> where anchor comes from headingAnchors()
// (the corpus chunker's slug). The markdown viewer must emit that same id and scroll to it.
import { describe, expect, it } from 'vitest';
import { parseMarkdown, renderMarkdownViewer } from '../../../src/viewers/markdown-viewer';
import { headingAnchors } from '../../../src/serve/heading-anchors';

const MD = '# Manual\n\n## 3.2 Clasificación de residuos\n\ntexto\n\n## Gestión\n\n## Gestión\n';

describe('markdown viewer section anchors', () => {
  it('leaves the rendered markup untouched (the editor depends on its block structure)', () => {
    expect(parseMarkdown('# Plan\n')).toContain('<h1 id="plan">Plan</h1>');
    expect(parseMarkdown('## Hello World\n')).not.toContain('<a id=');
  });

  it('the page script resolves ?section= with the corpus chunker function and scrolls to the heading', () => {
    const page = renderMarkdownViewer({
      slug: 's', artifactName: 'n', artifactType: 'markdown', typeMetadata: {}, baseUrl: 'https://x', content: MD,
      isAdmin: false, artifactId: 'a', loggedIn: false, isFavorite: false, nonce: 'abc',
    } as never);
    expect(page).toContain("get('section')");
    expect(page).toContain('scrollIntoView');
    expect(page).toContain('<script nonce="abc">(function(){var s=new URLSearchParams');
    // the embedded function is headingAnchors itself
    expect(page).toContain(headingAnchors.toString());
  });

  it('headingAnchors numbers repeats and folds accents (what the chunker and the script both compute)', () => {
    expect(headingAnchors(['Manual', '3.2 Clasificación de residuos', 'Gestión', 'Gestión']))
      .toEqual(['h-manual', 'h-3-2-clasificacion-de-residuos', 'h-gestion', 'h-gestion-2']);
  });
});
