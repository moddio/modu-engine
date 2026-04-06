import { describe, it, expect } from 'vitest';
import { ConditionEvaluator } from '../../../../engine/core/scripting/ConditionEvaluator';

describe('ConditionEvaluator', () => {
  const ce = new ConditionEvaluator();
  const identity = (v: any) => v;

  it('== comparison', () => {
    expect(ce.evaluate({ operator: '==', operandA: 5, operandB: 5 }, identity)).toBe(true);
    expect(ce.evaluate({ operator: '==', operandA: 5, operandB: 6 }, identity)).toBe(false);
  });

  it('!= comparison', () => {
    expect(ce.evaluate({ operator: '!=', operandA: 5, operandB: 6 }, identity)).toBe(true);
    expect(ce.evaluate({ operator: '!=', operandA: 5, operandB: 5 }, identity)).toBe(false);
  });

  it('< comparison', () => {
    expect(ce.evaluate({ operator: '<', operandA: 3, operandB: 5 }, identity)).toBe(true);
    expect(ce.evaluate({ operator: '<', operandA: 5, operandB: 3 }, identity)).toBe(false);
  });

  it('> comparison', () => {
    expect(ce.evaluate({ operator: '>', operandA: 5, operandB: 3 }, identity)).toBe(true);
    expect(ce.evaluate({ operator: '>', operandA: 3, operandB: 5 }, identity)).toBe(false);
  });

  it('<= comparison', () => {
    expect(ce.evaluate({ operator: '<=', operandA: 3, operandB: 5 }, identity)).toBe(true);
    expect(ce.evaluate({ operator: '<=', operandA: 5, operandB: 5 }, identity)).toBe(true);
    expect(ce.evaluate({ operator: '<=', operandA: 6, operandB: 5 }, identity)).toBe(false);
  });

  it('>= comparison', () => {
    expect(ce.evaluate({ operator: '>=', operandA: 5, operandB: 3 }, identity)).toBe(true);
    expect(ce.evaluate({ operator: '>=', operandA: 5, operandB: 5 }, identity)).toBe(true);
    expect(ce.evaluate({ operator: '>=', operandA: 3, operandB: 5 }, identity)).toBe(false);
  });

  it('AND logic', () => {
    expect(
      ce.evaluate(
        { operator: 'AND', operandA: true, operandB: true },
        identity,
      ),
    ).toBe(true);
    expect(
      ce.evaluate(
        { operator: 'AND', operandA: true, operandB: false },
        identity,
      ),
    ).toBe(false);
  });

  it('OR logic', () => {
    expect(
      ce.evaluate(
        { operator: 'OR', operandA: false, operandB: true },
        identity,
      ),
    ).toBe(true);
    expect(
      ce.evaluate(
        { operator: 'OR', operandA: false, operandB: false },
        identity,
      ),
    ).toBe(false);
  });

  it('nested conditions: AND(OR(a, b), c)', () => {
    const node = {
      operator: 'AND',
      operandA: {
        operator: 'OR',
        operandA: false,
        operandB: true,
      },
      operandB: true,
    };
    expect(ce.evaluate(node, identity)).toBe(true);
  });

  it('nested conditions: AND(OR(false, false), true) = false', () => {
    const node = {
      operator: 'AND',
      operandA: {
        operator: 'OR',
        operandA: false,
        operandB: false,
      },
      operandB: true,
    };
    expect(ce.evaluate(node, identity)).toBe(false);
  });

  it('identity resolver (pass-through)', () => {
    expect(ce.evaluate({ operator: '==', operandA: 'hello', operandB: 'hello' }, identity)).toBe(true);
  });

  it('custom resolver transforms values', () => {
    const resolver = (v: any) => (v === 'x' ? 10 : v);
    expect(
      ce.evaluate({ operator: '>', operandA: 'x', operandB: 5 }, resolver),
    ).toBe(true);
  });

  it('falsy leaf values', () => {
    expect(ce.evaluate(null, identity)).toBe(false);
    expect(ce.evaluate(undefined, identity)).toBe(false);
    expect(ce.evaluate(0, identity)).toBe(false);
    expect(ce.evaluate('', identity)).toBe(false);
    expect(ce.evaluate(1, identity)).toBe(true);
  });

  it('unknown operator returns false', () => {
    expect(
      ce.evaluate({ operator: 'NAND', operandA: true, operandB: true }, identity),
    ).toBe(false);
  });
});
