// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFormat, composeFormat, applyFormat } from '../src/bindings/format-editor';

function el(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild!;
}

describe('readFormat', () => {
  it('parses type + detail from data-shareout-format', () => {
    expect(readFormat(el('<span data-shareout-format="currency:EUR"></span>'))).toEqual({ type: 'currency', detail: 'EUR' });
    expect(readFormat(el('<span data-shareout-format="number"></span>'))).toEqual({ type: 'number', detail: '' });
    expect(readFormat(el('<span></span>'))).toEqual({ type: '', detail: '' });
  });
});

describe('composeFormat', () => {
  it('builds type[:detail], or null for plain text', () => {
    expect(composeFormat('', '')).toBeNull();
    expect(composeFormat('number', '')).toBe('number');
    expect(composeFormat('number', '2')).toBe('number:2');
    expect(composeFormat('currency', 'USD')).toBe('currency:USD');
    expect(composeFormat('date', ' short ')).toBe('date:short'); // trims detail
  });
});

describe('applyFormat', () => {
  it('sets the attribute, and removes it when type is cleared', () => {
    const node = el('<span data-shareout-binding="json:revenue"></span>');
    applyFormat(node, 'currency', 'USD');
    expect(node.getAttribute('data-shareout-format')).toBe('currency:USD');
    applyFormat(node, 'percent', '');
    expect(node.getAttribute('data-shareout-format')).toBe('percent');
    applyFormat(node, '', '');
    expect(node.hasAttribute('data-shareout-format')).toBe(false);
  });
});
