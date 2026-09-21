import { describe, expect, it } from 'vitest';
import { stripOriginPlaceholders, placeholderWarnings } from '../../../src/publish/origin-placeholder';

describe('origin placeholder repair', () => {
  it('makes unsubstituted shared-bundle URLs root-relative', () => {
    const html = [
      '<link rel="stylesheet" href="$ORIGIN/sdk/shareout.css">',
      '<script src="$ORIGIN/sdk/shareout-ui.js" defer></script>',
      "<script src='${ORIGIN}/sdk/shareout.js'></script>",
      '<script src="{ORIGIN}/vendor/d3@7/dist/d3.min.js"></script>',
      '<script type="module">import x from "{{ORIGIN}}/lib/acme/chart@1.0.0.js";</script>',
    ].join('\n');

    const fix = stripOriginPlaceholders(html);

    expect(fix.rewritten).toBe(5);
    expect(fix.unresolved).toBe(false);
    expect(fix.html).toContain('href="/sdk/shareout.css"');
    expect(fix.html).toContain('src="/sdk/shareout-ui.js"');
    expect(fix.html).toContain("src='/sdk/shareout.js'");
    expect(fix.html).toContain('src="/vendor/d3@7/dist/d3.min.js"');
    expect(fix.html).toContain('"/lib/acme/chart@1.0.0.js"');
    expect(fix.html).not.toContain('ORIGIN');
  });

  it('leaves a resolved origin and unquoted prose alone', () => {
    const html = '<script src="https://shareout.site/sdk/shareout.js"></script>\n<p>Set $ORIGIN first.</p>';
    const fix = stripOriginPlaceholders(html);
    expect(fix.rewritten).toBe(0);
    expect(fix.html).toBe(html);
  });

  it('reports a placeholder it cannot resolve instead of guessing', () => {
    const fix = stripOriginPlaceholders('<a href="$ORIGIN/v1/artifacts">list</a>');
    expect(fix.rewritten).toBe(0);
    expect(fix.unresolved).toBe(true);
    expect(fix.html).toContain('$ORIGIN/v1/artifacts');
    expect(placeholderWarnings(fix)).toEqual([
      expect.stringContaining('still contains an unresolved $ORIGIN placeholder'),
    ]);
  });

  it('does not mistake $ORIGIN_HOST for $ORIGIN', () => {
    const fix = stripOriginPlaceholders('<script src="$ORIGIN_HOST/sdk/shareout.js"></script>');
    expect(fix.rewritten).toBe(1);
    expect(fix.html).toContain('src="/sdk/shareout.js"');
  });

  it('warns once per repaired document', () => {
    const fix = stripOriginPlaceholders('<script src="$ORIGIN/sdk/shareout.js"></script>');
    expect(placeholderWarnings(fix)).toEqual([
      expect.stringContaining('Rewrote 1 unresolved $ORIGIN URL'),
    ]);
  });

  it('says nothing about clean HTML', () => {
    expect(placeholderWarnings(stripOriginPlaceholders('<p>hi</p>'))).toEqual([]);
  });
});
