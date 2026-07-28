// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  readTemplate,
  setTemplateName,
  setTemplateSource,
  templateSectionMarkup,
} from '../src/templates/template-editor';

function el(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html.trim();
  return host.firstElementChild!;
}

describe('readTemplate', () => {
  it('reads name/source and counts items + bindings', () => {
    const node = el(`
      <ul data-shareout-template="tasks" data-shareout-template-source="table:tasks">
        <li data-shareout-template-item><span data-shareout-binding="table:tasks:$id:title"></span></li>
        <li data-shareout-template-item><span data-shareout-binding="table:tasks:$id:done"></span></li>
      </ul>`);
    expect(readTemplate(node)).toEqual({
      name: 'tasks',
      source: 'table:tasks',
      itemCount: 2,
      bindingCount: 2,
    });
  });
});

describe('setters', () => {
  it('keeps the template attribute present even when the name is blanked', () => {
    const node = el('<ul data-shareout-template="x"></ul>');
    setTemplateName(node, '');
    expect(node.hasAttribute('data-shareout-template')).toBe(true);
    expect(node.getAttribute('data-shareout-template')).toBe('');
  });

  it('sets and clears the source', () => {
    const node = el('<ul data-shareout-template="x"></ul>');
    setTemplateSource(node, 'json:items');
    expect(node.getAttribute('data-shareout-template-source')).toBe('json:items');
    setTemplateSource(node, '');
    expect(node.hasAttribute('data-shareout-template-source')).toBe(false);
  });
});

describe('templateSectionMarkup', () => {
  it('renders name/source inputs, a source datalist, and a repeats readout', () => {
    const html = templateSectionMarkup(
      { name: 'tasks', source: 'table:tasks', itemCount: 2, bindingCount: 3 },
      ['table:tasks', 'json:items'],
    );
    expect(html).toContain('Template');
    expect(html).toContain('data-template-name');
    expect(html).toContain('value="tasks"');
    expect(html).toContain('data-template-source');
    expect(html).toContain('<datalist id="template-sources">');
    expect(html).toContain('2 items · 3 bindings');
  });

  it('singularizes a single item/binding', () => {
    const html = templateSectionMarkup({ name: 'x', source: '', itemCount: 1, bindingCount: 1 }, []);
    expect(html).toContain('1 item · 1 binding');
    expect(html).not.toContain('<datalist'); // no options → no datalist
  });
});
