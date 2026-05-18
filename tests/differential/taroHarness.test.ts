// packages/engine/tests/differential/taroHarness.test.ts
import { describe, it, expect } from 'vitest';
import { taroAvailable, runTaroCase } from './taroHarness';
import type { Case } from './types';

const d = taroAvailable() ? describe : describe.skip;

d('runTaroCase', () => {
  it('matches expected taro semantics for a basic case', () => {
    const c: Case = {
      name: 'basic',
      initialVars: { score: { value: 0, type: 'number' } },
      actions: [
        { type: 'setVariable', variableName: 'score', value: 3 },
        { type: 'repeat', count: 2, actions: [
          { type: 'increaseVariableByNumber', variableName: 'score', number: 1 },
          { type: 'log', value: { function: 'getVariable', variableName: 'score' } },
        ] },
      ],
    };
    const t = runTaroCase(c);
    expect(t.vars).toEqual({ score: 5 });
    expect(t.outputLog).toEqual([4, 5]);
    expect(t.flow).toEqual(['enter:repeat', 'iter:repeat#0', 'iter:repeat#1']);
  });
});

describe('taroAvailable', () => {
  it('returns a boolean', () => {
    expect(typeof taroAvailable()).toBe('boolean');
  });
});
