// Section anchors for headings without an id: a stable, deduplicated `h-` text slug the
// page agent can resolve in the browser; real ids still win.
import { describe, expect, it } from 'vitest';
import { CHUNKER_VERSION, chunkSections, htmlSections } from '../../../src/knowledge/corpus/sections';
import { headingAnchors } from '../../../src/serve/heading-anchors';

const anchors = (html: string) => htmlSections(html).sections.map((s) => s.anchor);

describe('heading anchors without ids', () => {
  it('slugs heading text: lowercased, hyphenated, prefixed h-', () => {
    expect(anchors('<body><h2>3.2 Waste  Classification!</h2><p>x</p><h3>Step <b>one</b> (A/B)</h3><p>y</p></body>'))
      .toEqual(['h-3-2-waste-classification', 'h-step-one-a-b']);
  });

  it('folds accents, including entity-encoded ones', () => {
    expect(anchors('<body><h2>Clasificación de residuos</h2><p>x</p><h2>Gesti&oacute;n &amp; se&ntilde;al&eacute;tica</h2><p>y</p></body>'))
      .toEqual(['h-clasificacion-de-residuos', 'h-gestion-senaletica']);
    expect(headingAnchors(['Ñandú – Über café'])).toEqual(['h-nandu-uber-cafe']);
  });

  it('dedupes repeated headings per page with -2, -3 (stable across runs)', () => {
    const html = '<body><h2>Notes</h2><p>a</p><h2>Notes</h2><p>b</p><h3>notes</h3><p>c</p></body>';
    expect(anchors(html)).toEqual(['h-notes', 'h-notes-2', 'h-notes-3']);
    expect(anchors(html)).toEqual(anchors(html));
    expect(headingAnchors(['Intro', 'Intro', 'Intro 2'])).toEqual(['h-intro', 'h-intro-2', 'h-intro-2-2']);
  });

  it('a real id (own or wrapping) wins, and still counts toward numbering', () => {
    const html = '<body><h2 id="scope">Scope</h2><p>a</p><section id="s2"><h2>Scope</h2><p>b</p></section><h2>Scope</h2><p>c</p></body>';
    expect(anchors(html)).toEqual(['scope', 's2', 'h-scope-3']);
  });

  it('headings with no Latin letters or digits get no anchor', () => {
    expect(anchors('<body><h2>…</h2><p>a</p></body>')).toEqual([null]);
  });

  it('chunks carry the slug anchor; chunker version is bumped so old sources re-learn', () => {
    const p = htmlSections('<title>Guide</title><body><h2>Clasificación</h2><p>Text.</p></body>');
    expect(chunkSections(p, { startOrd: 0, page: 'g.html', max: 5 })[0]).toMatchObject({ page: 'g.html', anchor: 'h-clasificacion' });
    expect(CHUNKER_VERSION).toBeGreaterThanOrEqual(2);
  });
});
