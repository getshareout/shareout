/**
 * evaluateReadiness — runs the shared rules over a ReadinessModel and produces a
 * graded ReadinessProfile. Each finding is annotated with `disables`: the editor
 * feature that gap costs, which matches the editor's graceful degradation (missing
 * markers disable features; they don't break the artifact).
 */

import type { Finding, ReadinessModel, ReadinessProfile } from './model';
import { runRules } from './rules';

/** What each rule's gap disables in the editor, keyed by rule id. */
const DISABLES: Record<string, string> = {
  'manifest-errors': 'manifest-driven autocomplete, data panel, and mock preview',
  'binding-undeclared': 'inline editing and formatting of this value',
  'conditional-undeclared': 'show/hide preview for this condition',
  'link-target-not-found': 'navigation preview to this target',
  'action-target-not-found': 'this action in the editor preview',
  'modal-no-open-trigger': 'opening this modal from the editor',
  'form-no-submit': 'form submission preview',
  'orphan-error-element': 'field error display wiring',
  'orphan-case': 'switch/case preview',
  'field-outside-form': 'form grouping for these fields',
  'required-field-no-validation': 'required-field validation feedback',
  'source-without-default': 'sample data in the editor preview',
  'connection-without-provenance': 'the "where does this come from?" entry in the Data sources drawer',
  'elements-without-source-link': 'per-element "where from?" badges for viewers',
};

export function evaluateReadiness(model: ReadinessModel): ReadinessProfile {
  const findings: Finding[] = runRules(model).map((finding) => {
    const disables = DISABLES[finding.rule];
    return disables ? { ...finding, disables } : finding;
  });

  const manifest: ReadinessProfile['manifest'] = !model.manifestPresent
    ? 'missing'
    : model.manifest.valid
      ? 'valid'
      : 'invalid';

  return {
    manifest,
    outline: model.pageIds.size > 0,
    counts: model.counts,
    summary: {
      errors: findings.filter((i) => i.level === 'error').length,
      warnings: findings.filter((i) => i.level === 'warning').length,
      infos: findings.filter((i) => i.level === 'info').length,
    },
    findings,
  };
}
