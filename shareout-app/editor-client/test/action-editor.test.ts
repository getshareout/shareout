// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  defaultTriggerFor,
  readAction,
  applyAction,
  clearAction,
  collectActionTargets,
  actionSectionMarkup,
} from '../src/actions/action-editor';

function el(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild!;
}

describe('defaultTriggerFor', () => {
  it('mirrors the runtime default per tag', () => {
    expect(defaultTriggerFor(el('<form></form>'))).toBe('submit');
    expect(defaultTriggerFor(el('<input>'))).toBe('change');
    expect(defaultTriggerFor(el('<select></select>'))).toBe('change');
    expect(defaultTriggerFor(el('<button></button>'))).toBe('click');
    expect(defaultTriggerFor(el('<div></div>'))).toBe('click');
  });
});

describe('readAction', () => {
  it('reads type/target/confirm and resolves the trigger from the default', () => {
    const node = el('<button data-shareout-action="navigate" data-shareout-action-target="page:home"></button>');
    expect(readAction(node)).toMatchObject({
      type: 'navigate',
      target: 'page:home',
      trigger: 'click',
      confirm: '',
      isChain: false,
      paramsError: false,
    });
  });

  it('prefers an explicit trigger over the default', () => {
    const node = el('<button data-shareout-action="toggle" data-shareout-action-trigger="hover"></button>');
    expect(readAction(node).trigger).toBe('hover');
  });

  it('flags a chain and a malformed params attribute', () => {
    const chain = el('<div data-shareout-actions="[]"></div>');
    expect(readAction(chain).isChain).toBe(true);

    const bad = el('<button data-shareout-action="set" data-shareout-action-params="{nope"></button>');
    expect(readAction(bad).paramsError).toBe(true);

    const good = el('<button data-shareout-action="set" data-shareout-action-params="{&quot;a&quot;:1}"></button>');
    expect(readAction(good).paramsError).toBe(false);
  });
});

describe('applyAction', () => {
  it('writes type/target/confirm', () => {
    const node = el('<button></button>');
    applyAction(node, { type: 'navigate', trigger: 'click', target: 'page:reports', confirm: 'Sure?' });
    expect(node.getAttribute('data-shareout-action')).toBe('navigate');
    expect(node.getAttribute('data-shareout-action-target')).toBe('page:reports');
    expect(node.getAttribute('data-shareout-action-confirm')).toBe('Sure?');
  });

  it('leaves the trigger implicit when it equals the element default, explicit otherwise', () => {
    const btn = el('<button></button>');
    applyAction(btn, { type: 'toggle', trigger: 'click', target: '', confirm: '' });
    expect(btn.hasAttribute('data-shareout-action-trigger')).toBe(false);

    applyAction(btn, { type: 'toggle', trigger: 'hover', target: '', confirm: '' });
    expect(btn.getAttribute('data-shareout-action-trigger')).toBe('hover');
  });

  it('clears every action attribute when the type is empty', () => {
    const node = el('<button data-shareout-action="delete" data-shareout-action-target="table:x" data-shareout-action-trigger="hover" data-shareout-action-confirm="!"></button>');
    applyAction(node, { type: '', trigger: 'click', target: 'table:x', confirm: '!' });
    expect(node.hasAttribute('data-shareout-action')).toBe(false);
    expect(node.hasAttribute('data-shareout-action-target')).toBe(false);
    expect(node.hasAttribute('data-shareout-action-trigger')).toBe(false);
    expect(node.hasAttribute('data-shareout-action-confirm')).toBe(false);
  });

  it('removes target/confirm when blanked', () => {
    const node = el('<button data-shareout-action="navigate" data-shareout-action-target="page:home" data-shareout-action-confirm="x"></button>');
    applyAction(node, { type: 'navigate', trigger: 'click', target: '', confirm: '' });
    expect(node.hasAttribute('data-shareout-action-target')).toBe(false);
    expect(node.hasAttribute('data-shareout-action-confirm')).toBe(false);
  });
});

describe('clearAction', () => {
  it('removes the four core action attributes', () => {
    const node = el('<button data-shareout-action="set" data-shareout-action-target="json:x" data-shareout-action-trigger="blur" data-shareout-action-confirm="?"></button>');
    clearAction(node);
    expect(node.attributes.length).toBe(0);
  });
});

describe('collectActionTargets', () => {
  it('collects pages/sections/modals plus history, deduped', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = `
      <div data-shareout-page="home"></div>
      <div data-shareout-page="home"></div>
      <section data-shareout-section="stats"></section>
      <div data-shareout-modal="add-task"></div>`;
    const targets = collectActionTargets(doc);
    expect(targets).toContain('page:home');
    expect(targets).toContain('section:stats');
    expect(targets).toContain('modal:add-task');
    expect(targets).toContain('history:back');
    expect(targets.filter((t) => t === 'page:home')).toHaveLength(1);
  });
});

describe('actionSectionMarkup', () => {
  const targets = ['page:home', 'modal:add'];

  it('renders the editor with a selected type and a "no action" option', () => {
    const html = actionSectionMarkup(readAction(el('<button data-shareout-action="navigate" data-shareout-action-target="page:home"></button>')), targets);
    expect(html).toContain('Action');
    expect(html).toContain('data-action-type');
    expect(html).toContain('— no action —');
    expect(html).toContain('value="navigate" selected');
    expect(html).toContain('page:home'); // datalist suggestion + current value
    expect(html).not.toContain('display:none'); // target/confirm rows visible when typed
  });

  it('hides target/confirm rows when there is no action type', () => {
    const html = actionSectionMarkup(
      { type: '', trigger: 'click', target: '', confirm: '', isChain: false, paramsError: false },
      targets,
    );
    expect(html).toContain('data-action-target-row style="display:none"');
    expect(html).toContain('data-action-confirm-row style="display:none"');
  });

  it('shows a chain note and a params warning when applicable', () => {
    const chainOnly = actionSectionMarkup(
      { type: '', trigger: 'click', target: '', confirm: '', isChain: true, paramsError: false },
      targets,
    );
    expect(chainOnly).toContain('data-shareout-actions');
    expect(chainOnly).not.toContain('data-action-type'); // pure chain: no single-action controls

    const withWarning = actionSectionMarkup(
      { type: 'set', trigger: 'click', target: '', confirm: '', isChain: false, paramsError: true },
      targets,
    );
    expect(withWarning).toContain('not valid JSON');
  });
});
