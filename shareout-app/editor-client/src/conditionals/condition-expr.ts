// Pure parse/compose for ShareOut conditional expressions (data-shareout-if/show/hide).
// Used by the Inspect "Visibility" editor. Tolerant of spacing (fixes the detector's
// space-required bug, e.g. "json:count>0").
import { CONDITION_OPERATORS, type ConditionOperator } from '../sdk-patterns';

export interface ConditionExpr {
  binding: string;
  operator: ConditionOperator | null;
  value: string | null;
}

const UNARY_OPERATORS = new Set<ConditionOperator>(['empty', '!empty']);

export function isUnaryOperator(op: ConditionOperator | null): boolean {
  return op !== null && UNARY_OPERATORS.has(op);
}

/** Parse a condition expression. Compound (AND/OR/NOT) is returned as a raw binding. */
export function parseConditionExpr(raw: string): ConditionExpr {
  const condition = (raw || '').trim();
  if (!condition) return { binding: '', operator: null, value: null };
  if (/ AND | OR |^NOT /.test(condition)) {
    return { binding: condition, operator: null, value: null };
  }

  // Most-specific operators first so '!=' beats '=', '>=' beats '>', '!empty' beats 'empty'.
  const ordered: ConditionOperator[] = ['!empty', 'empty', 'contains', '!=', '>=', '<=', '=', '>', '<'];
  for (const op of ordered) {
    const idx = operatorIndex(condition, op);
    if (idx === -1) continue;
    const binding = condition.slice(0, idx).trim();
    if (!binding) continue;
    if (UNARY_OPERATORS.has(op)) return { binding, operator: op, value: null };
    const value = condition.slice(idx + op.length).trim();
    return { binding, operator: op, value: value || null };
  }

  return { binding: condition, operator: null, value: null };
}

/** Compose a condition expression from its parts (inverse of parse for the common cases). */
export function composeConditionExpr(expr: ConditionExpr): string {
  if (!expr.binding) return '';
  if (!expr.operator) return expr.binding;
  if (UNARY_OPERATORS.has(expr.operator)) return `${expr.binding} ${expr.operator}`;
  return `${expr.binding} ${expr.operator} ${expr.value ?? ''}`.trim();
}

function operatorIndex(condition: string, op: ConditionOperator): number {
  // Word operators need a boundary; symbol operators may sit adjacent to the operands.
  if (op === 'contains' || op === 'empty' || op === '!empty') {
    const m = condition.match(new RegExp(`(^|\\s)${op}(\\s|$)`));
    return m ? m.index! + m[1].length : -1;
  }
  return condition.indexOf(op);
}

export { CONDITION_OPERATORS };
