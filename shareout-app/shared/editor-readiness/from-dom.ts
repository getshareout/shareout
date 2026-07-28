/**
 * DOM adapter (editor / browser). Builds a ReadinessModel from a live Document,
 * reproducing the selector and ancestor logic the editor's validation rules used to
 * run inline. Element refs are captured so the editor can navigate to findings.
 *
 * Worker code must NOT import this file — it depends on DOM globals.
 */

import type { ReadinessModel } from './model';
import {
  MANIFEST_SCRIPT_TYPE,
  parseManifestJson,
  sourcesWithoutDefaults,
  sourcesWithoutProvenance,
  type ParsedManifest,
} from './manifest';

function idSet(doc: Document, attr: string): Set<string> {
  const set = new Set<string>();
  doc.querySelectorAll(`[${attr}]`).forEach((el) => {
    const id = el.getAttribute(attr);
    if (id) set.add(id);
  });
  return set;
}

export function buildModelFromDom(doc: Document): ReadinessModel {
  const scriptEl = doc.querySelector(`script[type="${MANIFEST_SCRIPT_TYPE}"]`);
  const parsed: ParsedManifest | null = scriptEl
    ? parseManifestJson(scriptEl.textContent)
    : null;

  const pageIds = idSet(doc, 'data-shareout-page');
  const sectionIds = idSet(doc, 'data-shareout-section');
  const modalIds = idSet(doc, 'data-shareout-modal');
  const tabIds = idSet(doc, 'data-shareout-tab');
  const fieldIds = idSet(doc, 'data-shareout-field');
  const errorFieldIds = idSet(doc, 'data-shareout-error');

  const bindings = Array.from(doc.querySelectorAll('[data-shareout-binding]')).map((el) => ({
    expr: el.getAttribute('data-shareout-binding') || '',
    ref: el,
  }));

  const conditionals = Array.from(
    doc.querySelectorAll('[data-shareout-if], [data-shareout-show], [data-shareout-hide], [data-shareout-switch]')
  ).map((el) => ({
    expr:
      el.getAttribute('data-shareout-if') ||
      el.getAttribute('data-shareout-show') ||
      el.getAttribute('data-shareout-hide') ||
      el.getAttribute('data-shareout-switch') ||
      '',
    ref: el,
  }));

  const actions = Array.from(doc.querySelectorAll('[data-shareout-action]')).map((el) => ({
    type: el.getAttribute('data-shareout-action') || '',
    target: el.getAttribute('data-shareout-action-target') || '',
    ref: el,
  }));

  const links = Array.from(doc.querySelectorAll('[data-shareout-link]')).map((el) => ({
    target: el.getAttribute('data-shareout-link') || '',
    ref: el,
  }));

  const modals = Array.from(doc.querySelectorAll('[data-shareout-modal]')).map((el) => ({
    id: el.getAttribute('data-shareout-modal') || '',
    ref: el,
  }));

  const forms = Array.from(doc.querySelectorAll('[data-shareout-form]')).map((el) => ({
    id: el.getAttribute('data-shareout-form') || '',
    hasSubmitAttr: el.hasAttribute('data-shareout-form-submit'),
    hasSubmitDescendant:
      !!el.querySelector('[type="submit"], button:not([type])') ||
      !!el.querySelector('[data-shareout-action="submit"]'),
    ref: el,
  }));

  const cases = Array.from(doc.querySelectorAll('[data-shareout-case]')).map((el) => ({
    insideSwitch: !!el.closest('[data-shareout-switch]'),
    ref: el,
  }));

  const fields = Array.from(doc.querySelectorAll('[data-shareout-field]')).map((el) => ({
    insideForm: !!el.closest('[data-shareout-form]'),
  }));

  const errorElements = Array.from(doc.querySelectorAll('[data-shareout-error]')).map((el) => ({
    fieldId: el.getAttribute('data-shareout-error') || '',
    ref: el,
  }));

  const requiredFields = Array.from(doc.querySelectorAll('[data-shareout-field-required="true"]')).map((el) => ({
    fieldId: el.closest('[data-shareout-field]')?.getAttribute('data-shareout-field') ?? null,
    ref: el,
  }));

  const templateCount = doc.querySelectorAll('[data-shareout-template]').length;
  const sourceTaggedCount = doc.querySelectorAll('[data-shareout-source]').length;

  return {
    manifestPresent: parsed !== null,
    manifest: {
      valid: parsed?.valid ?? false,
      errors: parsed?.errors ?? [],
      jsonKeys: parsed?.jsonKeys ?? [],
      tableNames: parsed?.tableNames ?? [],
      connectionNames: parsed?.connectionNames ?? [],
      computedNames: parsed?.computedNames ?? [],
      sourcesWithoutDefaults: sourcesWithoutDefaults(parsed),
      sourcesWithoutProvenance: sourcesWithoutProvenance(parsed),
      feedCount: parsed?.feeds.length ?? 0,
    },
    sourceTaggedCount,
    pageIds,
    sectionIds,
    modalIds,
    tabIds,
    fieldIds,
    errorFieldIds,
    bindings,
    conditionals,
    actions,
    links,
    modals,
    forms,
    cases,
    fields,
    errorElements,
    requiredFields,
    counts: {
      pages: pageIds.size,
      sections: sectionIds.size,
      bindings: bindings.length,
      templates: templateCount,
    },
  };
}
