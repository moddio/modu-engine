// packages/engine/tests/differential/fuzz/generator.ts
import { mulberry32, randInt, pick } from './prng';
import type { Case } from '../types';

const VARS = ['a', 'b', 'c', 'd'] as const;
const NUM_POOL = [0, 1, 2, -1, 3, 5, 10, 0.5, -2.5, 100] as const;
const STR_POOL = ['', 'x', '5', '5abc', 'hello'] as const;
const OPS = ['+', '-', '*', '/', '%'] as const;
const CMP = ['==', '!=', '<', '>', '<=', '>='] as const;

function valueExpr(r: () => number, depth: number): unknown {
  const choice = depth <= 0 ? randInt(r, 0, 2) : randInt(r, 0, 4);
  switch (choice) {
    case 0: return pick(r, NUM_POOL);
    case 1: return pick(r, STR_POOL);
    case 2: return { function: 'getVariable', variableName: pick(r, VARS) };
    case 3: return {
      function: 'calculate',
      items: [{ operator: pick(r, OPS) }, valueExpr(r, depth - 1), valueExpr(r, depth - 1)],
    };
    default: return { function: 'concat', textA: valueExpr(r, depth - 1), textB: valueExpr(r, depth - 1) };
  }
}

function condition(r: () => number, depth: number): unknown {
  return {
    operator: pick(r, CMP),
    operandA: valueExpr(r, depth),
    operandB: valueExpr(r, depth),
  };
}

function actionList(r: () => number, n: number, depth: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    const kind = depth <= 0 ? randInt(r, 0, 3) : randInt(r, 0, 5);
    const v = pick(r, VARS);
    switch (kind) {
      case 0: out.push({ type: 'setVariable', variableName: v, value: valueExpr(r, depth) }); break;
      case 1: out.push({ type: 'increaseVariableByNumber', variableName: v, number: valueExpr(r, depth) }); break;
      case 2: out.push({ type: 'decreaseVariableByNumber', variableName: v, number: valueExpr(r, depth) }); break;
      case 3: out.push({ type: 'log', value: valueExpr(r, depth) }); break;
      case 4: out.push({
        type: 'condition',
        conditions: condition(r, depth - 1),
        then: actionList(r, randInt(r, 0, 2), depth - 1),
        else: actionList(r, randInt(r, 0, 2), depth - 1),
      }); break;
      default: out.push({
        type: 'repeat',
        count: randInt(r, 0, 4),
        actions: actionList(r, randInt(r, 1, 3), depth - 1),
      }); break;
    }
  }
  return out;
}

/** Build a deterministic in-scope pure-logic Case for a seed. */
export function generate(seed: number): Case {
  const r = mulberry32(seed);
  const initialVars: Case['initialVars'] = {};
  for (const v of VARS) {
    initialVars[v] = { value: pick(r, [0, 1, '', 'x', 10]), type: 'any' };
  }
  return {
    name: `fuzz-${seed}`,
    initialVars,
    actions: actionList(r, randInt(r, 3, 7), 3),
  };
}
