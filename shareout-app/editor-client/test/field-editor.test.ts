// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  fieldInputEl,
  readField,
  setFieldLabel,
  setFieldRequired,
  setFieldValidation,
  applyOptions,
  fieldSectionMarkup,
} from '../src/forms/field-editor';

function el(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html.trim();
  return host.firstElementChild!;
}

describe('fieldInputEl', () => {
  it('returns the child input, else the element itself', () => {
    const withInput = el('<div data-shareout-field="x"><input></div>');
    expect(fieldInputEl(withInput).tagName.toLowerCase()).toBe('input');
    const bare = el('<div data-shareout-field="x"></div>');
    expect(fieldInputEl(bare)).toBe(bare);
  });
});

describe('readField', () => {
  it('reads label/required and pulls validation from the input', () => {
    const node = el(
      '<div data-shareout-field="email" data-shareout-field-label="Email" data-shareout-field-required="true"><input data-shareout-validation="email"></div>',
    );
    expect(readField(node)).toMatchObject({
      fieldId: 'email',
      label: 'Email',
      required: true,
      validation: 'email',
      supportsOptions: false,
      optionsMode: 'none',
    });
  });

  it('detects a select source binding', () => {
    const node = el(
      '<div data-shareout-field="country"><select data-shareout-options-source="json:countries" data-shareout-options-value="code" data-shareout-options-label="name"></select></div>',
    );
    expect(readField(node)).toMatchObject({
      supportsOptions: true,
      optionsMode: 'source',
      optionsSource: 'json:countries',
      optionsValueKey: 'code',
      optionsLabelKey: 'name',
    });
  });

  it('detects static options and flags malformed JSON', () => {
    const good = el(`<div data-shareout-field="size"><select data-shareout-options='[{"value":"s"}]'></select></div>`);
    expect(readField(good)).toMatchObject({ optionsMode: 'static', optionsStaticError: false });

    const bad = el('<div data-shareout-field="size"><select data-shareout-options="[bad"></select></div>');
    expect(readField(bad).optionsStaticError).toBe(true);
  });
});

describe('setters target the correct element', () => {
  it('writes label/required on the field, validation on the input', () => {
    const node = el('<div data-shareout-field="email"><input></div>');
    const input = node.querySelector('input')!;

    setFieldLabel(node, 'Your email');
    setFieldRequired(node, true);
    setFieldValidation(node, 'email');
    expect(node.getAttribute('data-shareout-field-label')).toBe('Your email');
    expect(node.getAttribute('data-shareout-field-required')).toBe('true');
    expect(input.getAttribute('data-shareout-validation')).toBe('email');
    expect(node.hasAttribute('data-shareout-validation')).toBe(false);

    setFieldLabel(node, '');
    setFieldRequired(node, false);
    setFieldValidation(node, '');
    expect(node.hasAttribute('data-shareout-field-label')).toBe(false);
    expect(node.hasAttribute('data-shareout-field-required')).toBe(false);
    expect(input.hasAttribute('data-shareout-validation')).toBe(false);
  });
});

describe('applyOptions', () => {
  it('writes one mode at a time on the input, clearing the others', () => {
    const node = el('<div data-shareout-field="c"><select></select></div>');
    const input = node.querySelector('select')!;

    applyOptions(node, { mode: 'source', staticJson: '', source: 'json:countries', valueKey: 'code', labelKey: 'name' });
    expect(input.getAttribute('data-shareout-options-source')).toBe('json:countries');
    expect(input.getAttribute('data-shareout-options-value')).toBe('code');
    expect(input.hasAttribute('data-shareout-options')).toBe(false);

    applyOptions(node, { mode: 'static', staticJson: '[{"value":"a"}]', source: '', valueKey: '', labelKey: '' });
    expect(input.getAttribute('data-shareout-options')).toBe('[{"value":"a"}]');
    expect(input.hasAttribute('data-shareout-options-source')).toBe(false);
    expect(input.hasAttribute('data-shareout-options-value')).toBe(false);

    applyOptions(node, { mode: 'none', staticJson: '', source: '', valueKey: '', labelKey: '' });
    expect(input.hasAttribute('data-shareout-options')).toBe(false);
    expect(input.hasAttribute('data-shareout-options-source')).toBe(false);
  });
});

describe('fieldSectionMarkup', () => {
  const keys = ['json:countries', 'table:cities'];

  it('renders label/required/validation and no options block for a plain field', () => {
    const html = fieldSectionMarkup(readField(el('<div data-shareout-field="email" data-shareout-field-required="true"><input></div>')), keys);
    expect(html).toContain('Field');
    expect(html).toContain('data-field-label');
    expect(html).toContain('data-field-required checked');
    expect(html).toContain('data-field-validation');
    expect(html).not.toContain('data-field-options-mode');
  });

  it('renders the options mode + source rows for a select', () => {
    const html = fieldSectionMarkup(
      readField(el('<div data-shareout-field="c"><select data-shareout-options-source="json:countries"></select></div>')),
      keys,
    );
    expect(html).toContain('data-field-options-mode');
    expect(html).toContain('value="source" selected');
    expect(html).toContain('data-field-options-source');
    expect(html).toContain('json:countries');
  });

  it('shows the static textarea + JSON warning when options JSON is malformed', () => {
    const html = fieldSectionMarkup(
      readField(el('<div data-shareout-field="c"><select data-shareout-options="[bad"></select></div>')),
      keys,
    );
    expect(html).toContain('data-field-options-static');
    expect(html).toContain('not valid JSON');
  });
});
