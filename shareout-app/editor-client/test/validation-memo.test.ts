// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { runValidation, clearValidationCache } from '../src/validation/validation-detector';

function freshDoc(html = '<div data-shareout-page="home"></div>'): Document {
  const doc = document.implementation.createHTMLDocument('t');
  doc.body.innerHTML = html;
  return doc;
}

describe('runValidation memoization (F12)', () => {
  beforeEach(() => clearValidationCache());

  it('returns the cached result for an unchanged document (one scan, not three)', () => {
    const doc = freshDoc();
    const a = runValidation(doc);
    const b = runValidation(doc);
    const c = runValidation(doc);
    expect(b).toBe(a); // same object reference → no re-scan
    expect(c).toBe(a);
  });

  it('re-scans when the document content changes', () => {
    const doc = freshDoc();
    const a = runValidation(doc);
    doc.body.innerHTML += '<button data-shareout-action="navigate"></button>';
    const b = runValidation(doc);
    expect(b).not.toBe(a);
  });

  it('clearValidationCache forces a fresh scan', () => {
    const doc = freshDoc();
    const a = runValidation(doc);
    clearValidationCache();
    const b = runValidation(doc);
    expect(b).not.toBe(a);
    expect(b.issues).toEqual(a.issues); // same content → equivalent issues
  });
});
