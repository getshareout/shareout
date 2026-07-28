// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mapPresentation, mapSlide } from '../../../../src/data/slides/db';
import { makePresentation, makeSlide } from '../slides-mock-db';


describe('slides db mappers', () => {
  it('mapPresentation converts snake_case rows to camelCase', () => {
    const row = makePresentation({
      title: 'Deck',
      default_fonts: JSON.stringify({ heading: 'A', body: 'B', mono: 'C' }),
      default_colors: JSON.stringify({ background: '#000', text: '#fff', accent: '#00f' }),
      default_transition: JSON.stringify({ type: 'slide', duration: 500 }),
    });
    const mapped = mapPresentation(row);
    expect(mapped.title).toBe('Deck');
    expect(mapped.defaultFonts).toEqual({ heading: 'A', body: 'B', mono: 'C' });
    expect(mapped.defaultColors.background).toBe('#000');
    expect(mapped.defaultTransition.type).toBe('slide');
  });

  it('mapSlide parses optional JSON overrides and booleans', () => {
    const row = makeSlide({
      override_fonts: JSON.stringify({ heading: 'Serif' }),
      override_transition: JSON.stringify({ type: 'fade', duration: 200 }),
      hidden: 1,
      locked: 1,
    });
    const mapped = mapSlide(row);
    expect(mapped.overrideFonts).toEqual({ heading: 'Serif' });
    expect(mapped.overrideTransition).toEqual({ type: 'fade', duration: 200 });
    expect(mapped.hidden).toBe(true);
    expect(mapped.locked).toBe(true);
  });

  it('mapSlide returns null overrides when unset', () => {
    const mapped = mapSlide(makeSlide());
    expect(mapped.overrideFonts).toBeNull();
    expect(mapped.overrideTransition).toBeNull();
    expect(mapped.hidden).toBe(false);
  });
});

