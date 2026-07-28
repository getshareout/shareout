import { describe, it, expect } from 'vitest';
import { parseConditionExpr, composeConditionExpr, isUnaryOperator } from '../src/conditionals/condition-expr';

describe('parseConditionExpr', () => {
  it('parses binding / operator / value', () => {
    expect(parseConditionExpr('json:user.loggedIn = true')).toEqual({
      binding: 'json:user.loggedIn', operator: '=', value: 'true',
    });
  });

  it('tolerates missing spaces around symbol operators (detector bug fix)', () => {
    expect(parseConditionExpr('json:count>0')).toEqual({ binding: 'json:count', operator: '>', value: '0' });
    expect(parseConditionExpr('json:n>=5')).toEqual({ binding: 'json:n', operator: '>=', value: '5' });
    expect(parseConditionExpr('json:a!=b')).toEqual({ binding: 'json:a', operator: '!=', value: 'b' });
  });

  it('handles word + unary operators', () => {
    expect(parseConditionExpr('json:tags contains vip')).toEqual({ binding: 'json:tags', operator: 'contains', value: 'vip' });
    expect(parseConditionExpr('json:name empty')).toEqual({ binding: 'json:name', operator: 'empty', value: null });
    expect(parseConditionExpr('json:name !empty')).toEqual({ binding: 'json:name', operator: '!empty', value: null });
  });

  it('returns a bare binding when there is no operator, and leaves compound conditions raw', () => {
    expect(parseConditionExpr('json:flag')).toEqual({ binding: 'json:flag', operator: null, value: null });
    expect(parseConditionExpr('json:a AND json:b')).toEqual({ binding: 'json:a AND json:b', operator: null, value: null });
  });
});

describe('composeConditionExpr', () => {
  it('round-trips the common shapes', () => {
    expect(composeConditionExpr({ binding: 'json:x', operator: '>=', value: '5' })).toBe('json:x >= 5');
    expect(composeConditionExpr({ binding: 'json:x', operator: 'empty', value: null })).toBe('json:x empty');
    expect(composeConditionExpr({ binding: 'json:x', operator: null, value: null })).toBe('json:x');
    expect(composeConditionExpr({ binding: '', operator: '=', value: 'y' })).toBe('');
  });

  it('parse∘compose is stable for normalized input', () => {
    for (const s of ['json:a = b', 'json:c contains x', 'json:d empty', 'computed:e']) {
      expect(composeConditionExpr(parseConditionExpr(s))).toBe(s);
    }
  });
});

describe('isUnaryOperator', () => {
  it('flags empty/!empty', () => {
    expect(isUnaryOperator('empty')).toBe(true);
    expect(isUnaryOperator('!empty')).toBe(true);
    expect(isUnaryOperator('=')).toBe(false);
    expect(isUnaryOperator(null)).toBe(false);
  });
});
