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

    const left = resolveValue(aNode);
    const right = resolveValue(bNode);
    switch (op) {
      case '==': return left == right;
      case '!=': return left != right;
      case '<':  return Number(left) <  Number(right);
      case '>':  return Number(left) >  Number(right);
      case '<=': return Number(left) <= Number(right);
      case '>=': return Number(left) >= Number(right);
      default:   return false;
    }
  }
}
