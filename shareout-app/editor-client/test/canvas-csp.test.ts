import { describe, expect, it } from 'vitest';
import { CANVAS_CSP_ATTR, stripCanvasCsp, withCanvasCsp } from '../src/canvas/canvas-csp';

const POLICY = "script-src 'none'; object-src 'none'; base-uri 'none'";
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

function expectPolicyFirst(html: string): Document {
  const doc = parse(html);
  const first = doc.head.firstChild as Element;
  expect(first.nodeType).toBe(1);
  expect(first.localName).toBe('meta');
  expect(first.hasAttribute(CANVAS_CSP_ATTR)).toBe(true);
  expect(first.getAttribute('http-equiv')).toBe('Content-Security-Policy');
  expect(first.getAttribute('content')).toBe(POLICY);
  expect(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).toHaveLength(1);
  return doc;
}

function comments(doc: Document): string[] {
  const out: string[] = [];
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) out.push((walker.currentNode as Comment).data);
  return out;
}

describe('withCanvasCsp', () => {
  it('puts the policy first in head on a normal page', () => {
    const html = withCanvasCsp('<!doctype html><html lang="en"><head><title>t</title></head><body><p>hi</p></body></html>');
    expect(html.startsWith('<!DOCTYPE html><html lang="en"><head><meta ')).toBe(true);
    const doc = expectPolicyFirst(html);
    expect(doc.head.children[1].localName).toBe('title');
    expect(doc.body.innerHTML).toBe('<p>hi</p>');
  });

  it('puts the policy in head, not in a <header> element, on a page without <head>', () => {
    const doc = expectPolicyFirst(withCanvasCsp('<header><h1>Top</h1></header><main><p>x</p></main>'));
    expect(doc.querySelector('header meta')).toBeNull();
    expect(doc.querySelector('header')!.firstElementChild!.localName).toBe('h1');
  });

  it('puts the policy in the real head, not inside a commented-out one', () => {
    const doc = expectPolicyFirst(withCanvasCsp('<!doctype html><html><!--<head>--><head><title>t</title></head><body><!--<head>--><p>x</p></body></html>'));
    expect(comments(doc)).toEqual(['<head>', '<head>']);
  });

  it('puts the policy in the real head when an attribute mentions <head>', () => {
    expectPolicyFirst(withCanvasCsp('<html data-x="<head>"><body><p title="<head>">x</p></body></html>'));
  });

  it('keeps the document mode: no doctype stays without one, a bare fragment gets one', () => {
    expect(withCanvasCsp('<html><head></head><body>x</body></html>').startsWith('<html><head><meta ')).toBe(true);
    expect(withCanvasCsp('<p>x</p>').startsWith('<!DOCTYPE html><html><head><meta ')).toBe(true);
  });

  it('is removed again by stripCanvasCsp', () => {
    const doc = parse(withCanvasCsp('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="img-src *"></head><body></body></html>'));
    stripCanvasCsp(doc);
    expect(doc.querySelectorAll(`meta[${CANVAS_CSP_ATTR}]`)).toHaveLength(0);
    expect(doc.querySelector('meta[http-equiv]')!.getAttribute('content')).toBe('img-src *');
  });
});
