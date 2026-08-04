// packages/engine/tests/differential/tsHarness.test.ts
import { describe, it, expect } from 'vitest';
import { runTsCase } from './tsHarness';
import type { Case } from './types';

describe('runTsCase', () => {
  it('captures final vars, output log, and flow', () => {
    const c: Case = {
      name: 'basic',
      initialVars: { score: { value: 0, type: 'number' } },
      actions: [
        { type: 'setVariable', variableName: 'score', value: 3 },
        {
          type: 'repeat',
          count: 2,
          actions: [
            { type: 'increaseVariableByNumber', variableName: 'score', number: 1 },
            { type: 'log', value: { function: 'getVariable', variableName: 'score' } },
          ],
        },
      ],
    };
    const t = runTsCase(c);
    expect(t.vars).toEqual({ score: 5 });
    expect(t.outputLog).toEqual([4, 5]);
    expect(t.flow).toEqual(['enter:repeat', 'iter:repeat#0', 'iter:repeat#1']);
  });

  it('records return and break', () => {
    const c: Case = {
      name: 'flow',
      initialVars: { a: { value: 0, type: 'number' } },
      actions: [
        { type: 'repeat', count: 5, actions: [
          { type: 'increaseVariableByNumber', variableName: 'a', number: 1 },
          { type: 'condition',
            conditions: { operator: '>=', operandA: { function: 'getVariable', variableName: 'a' }, operandB: 2 },
            then: [{ type: 'break' }], else: [] },
        ] },
      ],
    };
    const t = runTsCase(c);
    expect(t.vars).toEqual({ a: 2 });
    expect(t.flow).toContain('break');
  });
});
