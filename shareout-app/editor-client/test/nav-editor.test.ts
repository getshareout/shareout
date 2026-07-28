// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  parseTarget,
  readLink,
  applyLink,
  readTransition,
  applyTransition,
  collectLinkTargetIds,
  linkSectionMarkup,
  transitionSectionMarkup,
} from '../src/navigation/nav-editor';

function el(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html.trim();
  return host.firstElementChild!;
}

describe('parseTarget', () => {
  it('splits type:id and keeps colons in the id (external URLs)', () => {
    expect(parseTarget('page:home')).toEqual({ targetType: 'page', targetId: 'home' });
    expect(parseTarget('external:https://x.com/a:b')).toEqual({
      targetType: 'external',
      targetId: 'https://x.com/a:b',
    });
  });

  it('treats a bare value as a page id', () => {
    expect(parseTarget('home')).toEqual({ targetType: 'page', targetId: 'home' });
  });
});

describe('readLink / applyLink', () => {
  it('reads target/display/active-class', () => {
    const node = el('<a data-shareout-link="section:pricing" data-shareout-link-display="Pricing" data-shareout-link-active-class="on"></a>');
    expect(readLink(node)).toEqual({
      targetType: 'section',
      targetId: 'pricing',
      display: 'Pricing',
      activeClass: 'on',
    });
  });

  it('composes the target and drops empty display/active-class', () => {
    const node = el('<a data-shareout-link="page:home" data-shareout-link-display="Home" data-shareout-link-active-class="on"></a>');
    applyLink(node, { targetType: 'modal', targetId: 'add-task', display: '', activeClass: '' });
    expect(node.getAttribute('data-shareout-link')).toBe('modal:add-task');
    expect(node.hasAttribute('data-shareout-link-display')).toBe(false);
    expect(node.hasAttribute('data-shareout-link-active-class')).toBe(false);
  });
});

describe('readTransition / applyTransition', () => {
  it('reads type + duration, defaulting type to none', () => {
    expect(readTransition(el('<div data-shareout-transition="fade" data-shareout-transition-duration="200"></div>'))).toEqual({
      type: 'fade',
      duration: '200',
    });
    expect(readTransition(el('<div data-shareout-transition=""></div>')).type).toBe('none');
  });

  it('writes type and drops an empty duration', () => {
    const node = el('<div data-shareout-transition="fade" data-shareout-transition-duration="200"></div>');
    applyTransition(node, 'slide-left', '');
    expect(node.getAttribute('data-shareout-transition')).toBe('slide-left');
    expect(node.hasAttribute('data-shareout-transition-duration')).toBe(false);
  });
});

describe('collectLinkTargetIds', () => {
  it('collects page/section/tab ids, deduped', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = `
      <div data-shareout-page="home"></div>
      <div data-shareout-page="home"></div>
      <section data-shareout-section="pricing"></section>
      <div data-shareout-tab="details"></div>`;
    const ids = collectLinkTargetIds(doc);
    expect(ids).toContain('home');
    expect(ids).toContain('pricing');
    expect(ids).toContain('details');
    expect(ids.filter((i) => i === 'home')).toHaveLength(1);
  });
});

describe('markup', () => {
  it('renders the link editor with the selected type + datalist', () => {
    const html = linkSectionMarkup(readLink(el('<a data-shareout-link="section:pricing"></a>')), ['home', 'pricing']);
    expect(html).toContain('Link');
    expect(html).toContain('value="section" selected');
    expect(html).toContain('data-link-target');
    expect(html).toContain('value="pricing"');
    expect(html).toContain('<datalist id="link-targets">');
    expect(html).toContain('data-link-active');
  });

  it('renders the transition editor with the selected animation + duration', () => {
    const html = transitionSectionMarkup({ type: 'zoom', duration: '150' });
    expect(html).toContain('Transition');
    expect(html).toContain('value="zoom" selected');
    expect(html).toContain('value="150"');
  });
});
