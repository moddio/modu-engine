// packages/engine/tests/differential/fuzz/generator.ts
import { mulberry32, randInt, pick } from './prng';
import type { Case } from '../types';

// Tamed, numeric-only grammar so the differential gate measures genuine
// LOGIC parity between the TS engine and old taro — not type-coercion edges.
// Coercion / NaN / divide-by-zero behaviour is covered by dedicated curated
// fixtures, never fuzzed (taro and the TS port legitimately diverge there).
const VARS = ['a', 'b', 'c', 'd'] as const;
const NUM_POOL = [0, 1, 2, -1, 3, 5, 10, -4, 7, 100] as const;
// Only +,-,* : division/modulo can yield NaN/Infinity where taro's calculate
// returns undefined while the TS engine returns 0 — a coercion edge, not logic.
const OPS = ['+', '-', '*'] as const;
const CMP = ['==', '!=', '<', '>', '<=', '>='] as const;

function valueExpr(r: () => number, depth: number): unknown {
  const choice = depth <= 0 ? randInt(r, 0, 1) : randInt(r, 0, 2);
  switch (choice) {
    case 0: return pick(r, NUM_POOL);
    case 1: return { function: 'getVariable', variableName: pick(r, VARS) };
    default: return {
      function: 'calculate',
      items: [{ operator: pick(r, OPS) }, valueExpr(r, depth - 1), valueExpr(r, depth - 1)],
    };
  }
}

/** taro-native condition encoding: [ {operator}, leftOperand, rightOperand ].
 *  The TS ConditionEvaluator also accepts this array form, so one shape feeds
 *  both engines. */
function condition(r: () => number, depth: number): unknown {
  return [{ operator: pick(r, CMP) }, valueExpr(r, depth), valueExpr(r, depth)];
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

/** Build a deterministic in-scope numeric-only pure-logic Case for a seed. */
export function generate(seed: number): Case {
  const r = mulberry32(seed);
  const initialVars: Case['initialVars'] = {};
  for (const v of VARS) {
    initialVars[v] = { value: pick(r, NUM_POOL), type: 'any' };
  }
  return {
    name: `fuzz-${seed}`,
    initialVars,
    actions: actionList(r, randInt(r, 3, 7), 3),
  };
}
