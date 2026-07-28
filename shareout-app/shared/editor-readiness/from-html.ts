/**
 * HTMLRewriter adapter (worker / publish). Builds a ReadinessModel from a raw HTML
 * string in a single streaming pass — no DOM. Ancestor context (inside a switch /
 * inside a form / form has a submit descendant) is tracked with depth counters and
 * stacks maintained across element start/end tags.
 *
 * This file uses the `HTMLRewriter` global and must only be imported by worker code.
 * Editor code uses `from-dom.ts` instead.
 */

import type { ReadinessModel } from './model';
import {
  parseManifest,
  sourcesWithoutDefaults,
  sourcesWithoutProvenance,
  type ParsedManifest,
} from './manifest';

export async function buildModelFromHtml(html: string): Promise<ReadinessModel> {
  const pageIds = new Set<string>();
  const sectionIds = new Set<string>();
  const modalIds = new Set<string>();
  const tabIds = new Set<string>();
  const fieldIds = new Set<string>();
  const errorFieldIds = new Set<string>();

  const bindings: ReadinessModel['bindings'] = [];
  const conditionals: ReadinessModel['conditionals'] = [];
  const actions: ReadinessModel['actions'] = [];
  const links: ReadinessModel['links'] = [];
  const modals: ReadinessModel['modals'] = [];
  const forms: ReadinessModel['forms'] = [];
  const cases: ReadinessModel['cases'] = [];
  const fields: ReadinessModel['fields'] = [];
  const errorElements: ReadinessModel['errorElements'] = [];
  const requiredFields: ReadinessModel['requiredFields'] = [];
  let templateCount = 0;
  let sourceTaggedCount = 0;

  // Ancestor tracking.
  let switchDepth = 0;
  let formDepth = 0;
  const fieldStack: string[] = [];
  const openForms: Array<{ hasSubmitDescendant: boolean }> = [];

  const markOpenFormsSubmit = () => {
    for (const f of openForms) f.hasSubmitDescendant = true;
  };

  const rewriter = new HTMLRewriter()
    .on('[data-shareout-page]', {
      element(el) {
        const id = el.getAttribute('data-shareout-page');
        if (id) pageIds.add(id);
      },
    })
    .on('[data-shareout-section]', {
      element(el) {
        const id = el.getAttribute('data-shareout-section');
        if (id) sectionIds.add(id);
      },
    })
    .on('[data-shareout-modal]', {
      element(el) {
        const id = el.getAttribute('data-shareout-modal') || '';
        if (id) modalIds.add(id);
        modals.push({ id });
      },
    })
    .on('[data-shareout-tab]', {
      element(el) {
        const id = el.getAttribute('data-shareout-tab');
        if (id) tabIds.add(id);
      },
    })
    .on('[data-shareout-template]', {
      element() {
        templateCount++;
      },
    })
    .on('[data-shareout-source]', {
      element() {
        sourceTaggedCount++;
      },
    })
    // Containers — register before the descendants that read their depth/stack.
    .on('[data-shareout-form]', {
      element(el) {
        forms.push({
          id: el.getAttribute('data-shareout-form') || '',
          hasSubmitAttr: el.hasAttribute('data-shareout-form-submit'),
          hasSubmitDescendant: false,
        });
        const record = forms[forms.length - 1];
        formDepth++;
        openForms.push(record);
        el.onEndTag(() => {
          formDepth--;
          openForms.pop();
        });
      },
    })
    .on('[data-shareout-field]', {
      element(el) {
        const id = el.getAttribute('data-shareout-field') || '';
        if (id) fieldIds.add(id);
        fields.push({ insideForm: formDepth > 0 });
        fieldStack.push(id);
        el.onEndTag(() => {
          fieldStack.pop();
        });
      },
    })
    // Submit detection: any of these as a form descendant gives the open form(s) a submit.
    .on('[type="submit"]', { element() { markOpenFormsSubmit(); } })
    .on('[data-shareout-action="submit"]', { element() { markOpenFormsSubmit(); } })
    .on('button', {
      element(el) {
        if (!el.hasAttribute('type')) markOpenFormsSubmit();
      },
    })
    .on('[data-shareout-error]', {
      element(el) {
        const id = el.getAttribute('data-shareout-error') || '';
        if (id) errorFieldIds.add(id);
        errorElements.push({ fieldId: id });
      },
    })
    .on('[data-shareout-binding]', {
      element(el) {
        bindings.push({ expr: el.getAttribute('data-shareout-binding') || '' });
      },
    })
    .on('[data-shareout-link]', {
      element(el) {
        links.push({ target: el.getAttribute('data-shareout-link') || '' });
      },
    })
    .on('[data-shareout-action]', {
      element(el) {
        actions.push({
          type: el.getAttribute('data-shareout-action') || '',
          target: el.getAttribute('data-shareout-action-target') || '',
        });
      },
    })
    .on('[data-shareout-case]', {
      element() {
        cases.push({ insideSwitch: switchDepth > 0 });
      },
    })
    .on('[data-shareout-field-required="true"]', {
      element() {
        requiredFields.push({ fieldId: fieldStack.length ? fieldStack[fieldStack.length - 1] : null });
      },
    })
    // Conditionals: one push per element at the highest-priority attribute present
    // (if > show > hide > switch), matching the editor's `if || show || hide || switch`.
    .on('[data-shareout-if]', {
      element(el) {
        conditionals.push({ expr: el.getAttribute('data-shareout-if') || '' });
      },
    })
    .on('[data-shareout-show]', {
      element(el) {
        if (el.hasAttribute('data-shareout-if')) return;
        conditionals.push({ expr: el.getAttribute('data-shareout-show') || '' });
      },
    })
    .on('[data-shareout-hide]', {
      element(el) {
        if (el.hasAttribute('data-shareout-if') || el.hasAttribute('data-shareout-show')) return;
        conditionals.push({ expr: el.getAttribute('data-shareout-hide') || '' });
      },
    })
    .on('[data-shareout-switch]', {
      element(el) {
        if (
          !el.hasAttribute('data-shareout-if') &&
          !el.hasAttribute('data-shareout-show') &&
          !el.hasAttribute('data-shareout-hide')
        ) {
          conditionals.push({ expr: el.getAttribute('data-shareout-switch') || '' });
        }
        switchDepth++;
        el.onEndTag(() => {
          switchDepth--;
        });
      },
    });

  await rewriter.transform(new Response(html)).arrayBuffer();

  const parsed: ParsedManifest | null = parseManifest(html);

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
