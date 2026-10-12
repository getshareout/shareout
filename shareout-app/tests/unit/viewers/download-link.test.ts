// @vitest-environment node
// The typed viewer's Download link must stay on the host that served the viewer
// (so `download` is honoured and the framed viewer never navigates away) and must
// URL-encode the artifact name.
import { describe, expect, it } from 'vitest';
import { renderViewer } from '../../../src/viewers';

function downloadHref(name: string, content: string): string {
  const html = renderViewer('markdown', 'glosario', name, {}, 'https://shareout.test', content, false, 'art_1', true, false)!;
  const m = /<a href="([^"]*)" download="/.exec(html);
  if (!m) throw new Error('no download link');
  return m[1];
}

describe('viewer Download link', () => {
  it('is a same-origin path to the source file, with the name encoded', () => {
    expect(downloadHref('Glosario #1 para agentes?', '# t\nbody')).toBe('/a/glosario/Glosario%20%231%20para%20agentes%3F.md');
  });

  it('uses /download for single-line content', () => {
    expect(downloadHref('Notas', 'one line')).toBe('/a/glosario/download');
  });
});
