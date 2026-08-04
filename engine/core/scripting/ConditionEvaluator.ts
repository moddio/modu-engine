export type ConditionOperator = 'AND' | 'OR' | '==' | '!=' | '<' | '>' | '<=' | '>=';

export class ConditionEvaluator {
  /**
   * Evaluate a condition tree. Supports both shapes found in taro/modu data:
   *   - Array: [{operator, operandType}, operandA, operandB]
   *       AND/OR operands are themselves condition arrays; comparison operands are
   *       resolvable values (literals or `{function: ...}` references).
   *   - Object: {operator, operandA, operandB} (legacy / test fixtures).
   *   - Anything else: evaluated as truthy via resolveValue(node).
   */
  evaluate(node: any, resolveValue: (val: any) => any): boolean {
    if (Array.isArray(node)) {
      const spec = node[0];
      if (!spec || typeof spec !== 'object' || typeof spec.operator !== 'string') return false;
      return this._apply(spec.operator as ConditionOperator, node[1], node[2], resolveValue);
    }
    if (node && typeof node === 'object' && typeof node.operator === 'string') {
      return this._apply(node.operator as ConditionOperator, node.operandA, node.operandB, resolveValue);
    }
    return !!resolveValue(node);
  }

  private _apply(
    op: ConditionOperator,
    aNode: unknown,
    bNode: unknown,
    resolveValue: (val: any) => any,
  ): boolean {
    if (op === 'AND') return this.evaluate(aNode, resolveValue) && this.evaluate(bNode, resolveValue);
    if (op === 'OR')  return this.evaluate(aNode, resolveValue) || this.evaluate(bNode, resolveValue);

    let left = resolveValue(aNode);
    let right = resolveValue(bNode);

    // Match taro ConditionComponent.js:25–58 semantics:
    //  1. If both operands are entities (have `_id`), compare by `_id`.
    //  2. For `==` only: undefined coerces to false; non-objects stringify before compare.
    //     This is so region-object equality works (same value → same JSON) and so
    //     `"5" == 5` evaluates the way taro scripts expect.
    if (left && (left as any)._id !== undefined && right && (right as any)._id !== undefined) {
      left = (left as any)._id;
      right = (right as any)._id;
    }

    switch (op) {
      case '==': {
        if (left === undefined) left = false;
        if (right === undefined) right = false;
        const ls = typeof left === 'object' ? left : JSON.stringify(left);
        const rs = typeof right === 'object' ? right : JSON.stringify(right);
        return ls == rs;
      }
      case '!=': return left != right;
      case '<':  return Number(left) <  Number(right);
      case '>':  return Number(left) >  Number(right);
      case '<=': return Number(left) <= Number(right);
      case '>=': return Number(left) >= Number(right);
      default:   return false;
    }
  }
}
