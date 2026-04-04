interface JsonAction {
  type: string;
  [key: string]: unknown;
}

interface JsonCondition {
  operandA: JsonOperand;
  operator: string;
  operandB: JsonOperand;
}

interface JsonOperand {
  function?: string;
  value?: unknown;
  entity?: JsonOperand;
  key?: string;
  items?: (string | JsonOperand)[];
  [key: string]: unknown;
}

export class JsonCompat {
  static transpile(json: JsonAction | JsonAction[]): string {
    const actions = Array.isArray(json) ? json : [json];
    return actions.map(a => JsonCompat._transpileAction(a)).join('\n');
  }

  private static _transpileAction(action: JsonAction): string {
    switch (action.type) {
      case 'condition':
        return JsonCompat._transpileCondition(action);
      case 'sendChatMessage':
        return `world.chat(${JsonCompat._transpileOperand(action.message as JsonOperand)});`;
      case 'setEntityAttribute': {
        const entity = JsonCompat._transpileOperand(action.entity as JsonOperand);
        const key = action.attributeType as string;
        const value = JsonCompat._transpileOperand(action.value as JsonOperand);
        return `${entity}.attr('${key}', ${value});`;
      }
      case 'moveEntity': {
        const entity = JsonCompat._transpileOperand(action.entity as JsonOperand);
        const pos = action.position as { x: JsonOperand; y: JsonOperand };
        return `${entity}.moveTo(${JsonCompat._transpileOperand(pos.x)}, ${JsonCompat._transpileOperand(pos.y)});`;
      }
      case 'destroyEntity': {
        const entity = JsonCompat._transpileOperand(action.entity as JsonOperand);
        return `${entity}.destroy();`;
      }
      case 'createUnit': {
        const type = action.unitType as string;
        return `world.createUnit('${type}');`;
      }
      default:
        return `// Unknown action: ${action.type}`;
    }
  }

  private static _transpileCondition(action: JsonAction): string {
    const conditions = action.conditions as JsonCondition[];
    const thenActions = action.then as JsonAction[] | undefined;
    const elseActions = action.else as JsonAction[] | undefined;
    const op = action.operator as string;

    const condStr = conditions
      .map(c => {
        const a = JsonCompat._transpileOperand(c.operandA);
        const b = JsonCompat._transpileOperand(c.operandB);
        return `${a} ${JsonCompat._mapOperator(c.operator)} ${b}`;
      })
      .join(op === 'AND' ? ' && ' : ' || ');

    let result = `if (${condStr}) {\n`;
    if (thenActions) {
      result += thenActions.map(a => '  ' + JsonCompat._transpileAction(a)).join('\n') + '\n';
    }
    result += '}';
    if (elseActions && elseActions.length > 0) {
      result += ' else {\n';
      result += elseActions.map(a => '  ' + JsonCompat._transpileAction(a)).join('\n') + '\n';
      result += '}';
    }
    return result;
  }

  private static _transpileOperand(operand: JsonOperand | string | number | undefined): string {
    if (operand === undefined) return 'undefined';
    if (typeof operand === 'string') return `'${operand}'`;
    if (typeof operand === 'number') return String(operand);

    if (!operand.function) {
      if (operand.value !== undefined) return String(operand.value);
      return 'undefined';
    }

    switch (operand.function) {
      case 'thisEntity': return 'self';
      case 'getEntityAttribute': {
        const entity = JsonCompat._transpileOperand(operand.entity as JsonOperand);
        return `${entity}.attr('${operand.key}')`;
      }
      case 'number': return String(operand.value);
      case 'string': return `'${operand.value}'`;
      case 'concat': {
        const items = (operand.items as (string | JsonOperand)[]).map(i => JsonCompat._transpileOperand(i as JsonOperand));
        return items.join(' + ');
      }
      case 'getVariable': return `vars.${operand.key}`;
      default: return `/* ${operand.function}() */`;
    }
  }

  private static _mapOperator(op: string): string {
    switch (op) {
      case 'greaterThan': return '>';
      case 'lessThan': return '<';
      case 'greaterThanOrEqualTo': return '>=';
      case 'lessThanOrEqualTo': return '<=';
      case 'equals': return '===';
      case 'notEquals': return '!==';
      default: return op;
    }
  }
}
