// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderDeckHtml } from '../../../src/present/deck-template';

// Both surfaces here are seen by people who are NOT users of the instance — a client
// receiving a file, an audience watching a deck. Carrying the founder domain out to
// them is the same defect as the forced "Made with ShareOut" badge removed in #44.

describe('generated deck footer', () => {
  const deck = { title: 'Q3 review', slides: [{ heading: 'One', bullets: ['a'] }] };

  it('names the instance the deck came from', () => {
    const html = renderDeckHtml(deck, 'acme.workers.dev');
    expect(html).toContain('acme.workers.dev');
    expect(html).not.toContain('shareout.site');
  });

  it('escapes the host rather than interpolating it raw', () => {
    const html = renderDeckHtml(deck, '<script>x</script>');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('still renders the hosted domain when that is the instance', () => {
    expect(renderDeckHtml(deck, 'shareout.site')).toContain('shareout.site');
  });
});
