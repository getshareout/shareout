/** An `IN` operand bound as ONE JSON parameter. D1 caps a statement at 100 bound
 *  parameters, so a `?`-per-value list fails once an unbounded array passes ~100.
 *  Use as `col IN ${JSON_IN}` and bind `jsonList(values)` in its place. */
export const JSON_IN = '(SELECT value FROM json_each(?))';

export const jsonList = (values: readonly unknown[]): string => JSON.stringify(values);
