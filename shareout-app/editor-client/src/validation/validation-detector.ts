/**
 * ShareOut Validation Detector v2.0
 *
 * Builds the shared ReadinessModel from the document, runs the shared rule set, and
 * maps the findings back to the editor's ValidationIssue shape (carrying the DOM
 * element for navigation). The rule definitions are shared with the publish-time
 * worker, so the editor and publish never disagree on what "editor-ready" means.
 */

import { extractManifestFromDocument, type ParsedManifest } from '../manifest/manifest-parser';
import { type ValidationIssue } from './validation-rules';
import { buildModelFromDom } from '../../../shared/editor-readiness/from-dom';
import { evaluateReadiness } from '../../../shared/editor-readiness/evaluate';
import type { Finding } from '../../../shared/editor-readiness/model';

export interface ValidationResult {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  infos: ValidationIssue[];
  manifest: ParsedManifest | null;
  timestamp: number;
}

// Memoize by a content signature so the panel + badge (+ refresh) don't each re-parse the
// manifest and re-run every rule for the same document (EDIT-05 F12). The signature is the
// document HTML — cheaper than the full scan it guards, and content-addressed so any edit
// invalidates it.
let memo: { signature: string; result: ValidationResult } | null = null;

export function clearValidationCache(): void {
  memo = null;
}

export function runValidation(doc: Document): ValidationResult {
  const signature = doc.documentElement.outerHTML;
  if (memo && memo.signature === signature) return memo.result;
  const result = computeValidation(doc);
  memo = { signature, result };
  return result;
}

function toIssue(finding: Finding): ValidationIssue {
  return {
    id: finding.id,
    level: finding.level,
    category: finding.category,
    message: finding.message,
    suggestion: finding.suggestion,
    element: finding.ref as Element | undefined,
  };
}

function computeValidation(doc: Document): ValidationResult {
  const manifest = extractManifestFromDocument(doc);
  const profile = evaluateReadiness(buildModelFromDom(doc));
  const issues = profile.findings.map(toIssue);

  return {
    issues,
    errors: issues.filter(i => i.level === 'error'),
    warnings: issues.filter(i => i.level === 'warning'),
    infos: issues.filter(i => i.level === 'info'),
    manifest,
    timestamp: Date.now(),
  };
}
