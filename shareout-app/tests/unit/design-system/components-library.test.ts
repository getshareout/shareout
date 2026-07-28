// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  button,
  field,
  card,
  badge,
  modalShell,
  componentStylesheet,
  componentScripts,
} from '../../../src/design-system/components/index';

describe('shared component markup helpers', () => {
  it('button() renders variant + block classes and attributes', () => {
    const html = button({ label: 'Save', variant: 'primary', id: 'b1', onclick: 'go()', block: true });
    expect(html).toContain('class="so-c-btn so-c-btn--primary so-c-btn--block"');
    expect(html).toContain('id="b1"');
    expect(html).toContain('onclick="go()"');
    expect(html).toContain('>Save</button>');
    expect(button({ label: 'X' })).toContain('so-c-btn--primary'); // default variant
    expect(button({ label: 'X', disabled: true })).toContain('disabled');
  });

  it('field() wraps a labelled control with optional hint', () => {
    const html = field({ id: 'email', label: 'Email', control: '<input id="email" class="so-c-input">', hint: 'we never share it' });
    expect(html).toContain('class="so-c-field"');
    expect(html).toContain('<label class="so-c-label" for="email">Email</label>');
    expect(html).toContain('class="so-c-hint"');
    expect(field({ id: 'a', label: 'A', control: '<input>' })).not.toContain('so-c-hint');
  });

  it('modalShell() is hidden by default and carries the data-so-modal hook', () => {
    const html = modalShell({ id: 'm1', title: 'Confirm', body: '<p>Sure?</p>', footer: button({ label: 'OK' }), top: true });
    expect(html).toContain('id="m1"');
    expect(html).toContain('so-c-modal-overlay so-c-modal-overlay--top');
    expect(html).toContain('data-so-modal');
    expect(html).toContain('style="display:none;"');
    expect(html).toContain('so-c-modal__head');
    expect(html).toContain('so-c-modal__body');
    expect(html).toContain('so-c-modal__foot');
  });

  it('card() and badge() emit shared classes', () => {
    expect(card({ title: 'T', body: 'B', interactive: true })).toContain('so-c-card so-c-card--interactive');
    expect(badge({ label: 'New', variant: 'success' })).toContain('so-c-badge so-c-badge--success');
  });
});

describe('componentStylesheet()', () => {
  it('includes every primitive class set', () => {
    const css = componentStylesheet();
    for (const cls of ['.so-c-btn', '.so-c-input', '.so-c-modal', '.so-c-card', '.so-c-badge', '.so-c-toast']) {
      expect(css).toContain(cls);
    }
  });

  it('omits base CSS vars by default, prepends them with { withVars: true }', () => {
    expect(componentStylesheet()).not.toContain('--color-primary:');
    expect(componentStylesheet({ withVars: true })).toContain('--color-primary:');
  });

  it('includes the theme scopes that re-skin components per surface', () => {
    const css = componentStylesheet();
    expect(css).toContain('.so-theme-glass');
    expect(css).toContain('.so-theme-admin');
    // components read --soc-* hooks so themes can override them
    expect(css).toContain('var(--soc-modal-bg');
    expect(css).toContain('var(--soc-input-border');
  });

  it('componentScripts defines the shared modal + toast globals', () => {
    expect(componentScripts).toContain('window.soModalOpen');
    expect(componentScripts).toContain('window.soModalClose');
    expect(componentScripts).toContain('window.showToast');
  });
});
