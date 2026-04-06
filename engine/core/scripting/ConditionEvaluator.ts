export type ConditionOperator = 'AND' | 'OR' | '==' | '!=' | '<' | '>' | '<=' | '>=';

export type ConditionNode =
  | { operator: ConditionOperator; operandA: ConditionNode; operandB: ConditionNode }
  | unknown; // Leaf value (resolved by ParameterResolver)

export class ConditionEvaluator {
  evaluate(node: any, resolveValue: (val: any) => any): boolean {
    if (!node || typeof node !== 'object' || !node.operator) {
      return !!resolveValue(node);
    }

    const op = node.operator as ConditionOperator;

    if (op === 'AND') {
      return (
        this.evaluate(node.operandA, resolveValue) &&
        this.evaluate(node.operandB, resolveValue)
      );
    }
    if (op === 'OR') {
      return (
        this.evaluate(node.operandA, resolveValue) ||
        this.evaluate(node.operandB, resolveValue)
      );
    }

    const left = resolveValue(node.operandA);
    const right = resolveValue(node.operandB);

    switch (op) {
      case '==':
        return left == right;
      case '!=':
        return left != right;
      case '<':
        return Number(left) < Number(right);
      case '>':
        return Number(left) > Number(right);
      case '<=':
        return Number(left) <= Number(right);
      case '>=':
        return Number(left) >= Number(right);
      default:
        return false;
    }
  }
}
