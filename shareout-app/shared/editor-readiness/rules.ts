/**
 * Editor-readiness rules — ported verbatim from the editor's validation-rules.ts,
 * but operating on the parser-agnostic ReadinessModel instead of a live DOM.
 * Rule ids, levels, messages, and suggestions are preserved exactly so the editor's
 * existing behavior is unchanged.
 */

import type { Finding, IssueCategory, IssueLevel, ReadinessModel } from './model';

interface Rule {
  id: string;
  check: (m: ReadinessModel) => Finding[];
}

const f = (
  id: string,
  rule: string,
  level: IssueLevel,
  category: IssueCategory,
  message: string,
  extra?: { suggestion?: string; ref?: unknown }
): Finding => ({ id, rule, level, category, message, ...extra });

export const RULES: Rule[] = [
  {
    id: 'manifest-errors',
    check: (m) =>
      m.manifest.errors.map((err, idx) =>
        f(`manifest-error-${idx}`, 'manifest-errors', 'error', 'manifest', err, {
          suggestion: 'Fix the manifest JSON syntax',
        })
      ),
  },

  {
    id: 'modal-no-open-trigger',
    check: (m) => {
      const openTargets = new Set<string>();
      for (const a of m.actions) {
        if (a.type === 'open' && a.target.startsWith('modal:')) {
          openTargets.add(a.target.slice(6));
        }
      }
      const issues: Finding[] = [];
      for (const modal of m.modals) {
        if (modal.id && !openTargets.has(modal.id)) {
          issues.push(
            f(`modal-no-trigger-${modal.id}`, 'modal-no-open-trigger', 'warning', 'action',
              `Modal "${modal.id}" has no open trigger`, {
                suggestion: 'Add a button with data-shareout-action="open" data-shareout-action-target="modal:' + modal.id + '"',
                ref: modal.ref,
              })
          );
        }
      }
      return issues;
    },
  },

  {
    id: 'form-no-submit',
    check: (m) => {
      const issues: Finding[] = [];
      for (const form of m.forms) {
        if (!form.hasSubmitAttr && !form.hasSubmitDescendant) {
          issues.push(
            f(`form-no-submit-${form.id}`, 'form-no-submit', 'warning', 'form',
              `Form "${form.id}" has no submit mechanism`, {
                suggestion: 'Add data-shareout-form-submit attribute or a submit button',
                ref: form.ref,
              })
          );
        }
      }
      return issues;
    },
  },

  {
    id: 'link-target-not-found',
    check: (m) => {
      const issues: Finding[] = [];
      m.links.forEach((link, idx) => {
        const [type, name] = link.target.split(':');
        if (!type || !name) return;
        let exists = false;
        switch (type) {
          case 'page': exists = m.pageIds.has(name); break;
          case 'section': exists = m.sectionIds.has(name); break;
          case 'modal': exists = m.modalIds.has(name); break;
          case 'tab': exists = m.tabIds.has(name); break;
          case 'external':
          case 'history': exists = true; break;
        }
        if (!exists) {
          issues.push(
            f(`link-not-found-${idx}`, 'link-target-not-found', 'warning', 'navigation',
              `Link target "${link.target}" not found`, {
                suggestion: `Create a ${type} with id "${name}"`,
                ref: link.ref,
              })
          );
        }
      });
      return issues;
    },
  },

  {
    id: 'action-target-not-found',
    check: (m) => {
      const issues: Finding[] = [];
      m.actions.forEach((action, idx) => {
        const target = action.target;
        if (!target || action.type === 'call' || action.type === 'submit') return;
        const [type, name] = target.split(':');
        if (!type || !name) return;
        let exists = false;
        switch (type) {
          case 'page': exists = m.pageIds.has(name); break;
          case 'section': exists = m.sectionIds.has(name); break;
          case 'modal': exists = m.modalIds.has(name); break;
          case 'tab': exists = m.tabIds.has(name); break;
          case 'json': exists = m.manifest.jsonKeys.includes(name.split('.')[0]); break;
          case 'table': exists = m.manifest.tableNames.includes(name); break;
          case 'history':
          case 'fn': exists = true; break;
        }
        if (!exists) {
          issues.push(
            f(`action-target-not-found-${idx}`, 'action-target-not-found', 'warning', 'action',
              `Action target "${target}" not found`, {
                suggestion: `Define ${type} "${name}" or update the target`,
                ref: action.ref,
              })
          );
        }
      });
      return issues;
    },
  },

  {
    id: 'binding-undeclared',
    check: (m) => {
      const issues: Finding[] = [];
      m.bindings.forEach((b, idx) => {
        const [type, name] = b.expr.split(':');
        if (!type || !name) return;
        const rootName = name.split('.')[0];
        let exists = false;
        switch (type) {
          case 'json': exists = m.manifest.jsonKeys.includes(rootName); break;
          case 'table': exists = m.manifest.tableNames.includes(rootName); break;
          case 'computed': exists = m.manifest.computedNames.includes(rootName); break;
          default: exists = true;
        }
        if (!exists) {
          issues.push(
            f(`binding-undeclared-${idx}`, 'binding-undeclared', 'warning', 'binding',
              `Binding "${b.expr}" references undeclared ${type} "${rootName}"`, {
                suggestion: `Declare "${rootName}" in the manifest sources`,
                ref: b.ref,
              })
          );
        }
      });
      return issues;
    },
  },

  {
    id: 'conditional-undeclared',
    check: (m) => {
      const issues: Finding[] = [];
      m.conditionals.forEach((c, idx) => {
        const bindingMatch = c.expr.match(/^(json|table|computed):([^\s]+)/);
        if (!bindingMatch) return;
        const [, type, name] = bindingMatch;
        const rootName = name.split('.')[0];
        let exists = false;
        switch (type) {
          case 'json': exists = m.manifest.jsonKeys.includes(rootName); break;
          case 'table': exists = m.manifest.tableNames.includes(rootName); break;
          case 'computed': exists = m.manifest.computedNames.includes(rootName); break;
        }
        if (!exists) {
          issues.push(
            f(`conditional-undeclared-${idx}`, 'conditional-undeclared', 'warning', 'conditional',
              `Condition references undeclared ${type}:${rootName}`, {
                suggestion: `Declare "${rootName}" in the manifest`,
                ref: c.ref,
              })
          );
        }
      });
      return issues;
    },
  },

  {
    id: 'orphan-error-element',
    check: (m) => {
      const issues: Finding[] = [];
      m.errorElements.forEach((el, idx) => {
        if (!el.fieldId) return;
        if (!m.fieldIds.has(el.fieldId)) {
          issues.push(
            f(`orphan-error-${idx}`, 'orphan-error-element', 'info', 'orphan',
              `Error element for field "${el.fieldId}" has no matching field`, {
                suggestion: `Create field with data-shareout-field="${el.fieldId}"`,
                ref: el.ref,
              })
          );
        }
      });
      return issues;
    },
  },

  {
    id: 'orphan-case',
    check: (m) => {
      const issues: Finding[] = [];
      m.cases.forEach((c, idx) => {
        if (!c.insideSwitch) {
          issues.push(
            f(`orphan-case-${idx}`, 'orphan-case', 'warning', 'orphan',
              'Case element is not inside a switch container', {
                suggestion: 'Wrap cases in a parent with data-shareout-switch',
                ref: c.ref,
              })
          );
        }
      });
      return issues;
    },
  },

  {
    id: 'field-outside-form',
    check: (m) => {
      const standaloneCount = m.fields.filter((field) => !field.insideForm).length;
      if (standaloneCount > 3) {
        return [
          f('many-standalone-fields', 'field-outside-form', 'info', 'form',
            `${standaloneCount} fields are not inside a form`, {
              suggestion: 'Consider grouping related fields into a form',
            }),
        ];
      }
      return [];
    },
  },

  {
    id: 'required-field-no-validation',
    check: (m) => {
      const issues: Finding[] = [];
      m.requiredFields.forEach((rf, idx) => {
        if (!rf.fieldId) return;
        if (!m.errorFieldIds.has(rf.fieldId)) {
          issues.push(
            f(`required-no-error-${idx}`, 'required-field-no-validation', 'info', 'form',
              `Required field "${rf.fieldId}" has no error display element`, {
                suggestion: `Add <span data-shareout-error="${rf.fieldId}"></span> for validation feedback`,
                ref: rf.ref,
              })
          );
        }
      });
      return issues;
    },
  },

  {
    id: 'source-without-default',
    check: (m) =>
      m.manifest.sourcesWithoutDefaults.map((src, idx) =>
        f(`source-without-default-${idx}`, 'source-without-default', 'info', 'manifest',
          `Source "${src}" has no default sample data — the visual editor previews it empty`, {
            suggestion: `Add a "default" to "${src}" in the manifest so the editor can preview real-looking content`,
          })
      ),
  },

  // Provenance — advisory nudges so viewers can answer "where does this data come from?".
  {
    id: 'connection-without-provenance',
    check: (m) =>
      m.manifest.sourcesWithoutProvenance
        .filter((src) => src.startsWith('connection:'))
        .map((src, idx) =>
          f(`connection-without-provenance-${idx}`, 'connection-without-provenance', 'warning', 'provenance',
            `Live source "${src}" declares no query or description — viewers can't tell where this data comes from`, {
              suggestion: `Add "query", "description", and/or "replication" to sources.connections.${src.slice('connection:'.length)} so the Data sources drawer can explain it`,
            })
        ),
  },

  {
    id: 'elements-without-source-link',
    check: (m) => {
      const hasLiveData = m.manifest.connectionNames.length > 0;
      if (!hasLiveData) return [];
      if (m.sourceTaggedCount > 0 || m.manifest.feedCount > 0) return [];
      return [
        f('elements-without-source-link', 'elements-without-source-link', 'info', 'provenance',
          'No chart or table is linked to its data source', {
            suggestion: 'Tag charts/tables with data-shareout-source="<sourceKey>" (or add manifest "feeds") so viewers get a per-element "where from?" badge',
          }),
      ];
    },
  },
];

export function runRules(model: ReadinessModel): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    try {
      findings.push(...rule.check(model));
    } catch {
      // Skip failed rules, matching the editor's per-rule try/catch.
    }
  }
  return findings;
}
