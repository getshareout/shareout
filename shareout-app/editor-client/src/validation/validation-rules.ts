/**
 * ShareOut Validation types + presentation (editor).
 *
 * The rule logic now lives in the shared editor-readiness module
 * (`shared/editor-readiness/rules.ts`) so the editor and the publish-time worker
 * apply one definition. This file keeps the editor-facing issue shape (which carries
 * a DOM `element` for navigation) and the panel icons.
 */

import type { IssueLevel, IssueCategory } from '../../../shared/editor-readiness/model';

export type { IssueLevel, IssueCategory };

export interface ValidationIssue {
  id: string;
  level: IssueLevel;
  category: IssueCategory;
  message: string;
  element?: Element;
  suggestion?: string;
}

export function getIssueIcon(level: IssueLevel): string {
  switch (level) {
    case 'error': return '🔴';
    case 'warning': return '⚠️';
    case 'info': return 'ℹ️';
  }
}

export function getCategoryIcon(category: IssueCategory): string {
  switch (category) {
    case 'manifest': return '📄';
    case 'binding': return '🔗';
    case 'form': return '📝';
    case 'action': return '⚡';
    case 'conditional': return '🔀';
    case 'navigation': return '🧭';
    case 'orphan': return '👻';
    case 'provenance': return '🗃️';
  }
}
