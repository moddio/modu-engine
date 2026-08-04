// packages/engine/tests/differential/fuzz/generator.test.ts
import { describe, it, expect } from 'vitest';
import { generate } from './generator';

describe('generate', () => {
  it('is deterministic per seed', () => {
    expect(JSON.stringify(generate(7))).toEqual(JSON.stringify(generate(7)));
  });
  it('declares every variable it uses', () => {
    for (let s = 0; s < 30; s++) {
      const c = generate(s);
      const declared = new Set(Object.keys(c.initialVars));
      const json = JSON.stringify(c.actions);
      for (const m of json.matchAll(/"variableName":"([^"]+)"/g)) {
        expect(declared.has(m[1])).toBe(true);
      }
    }
  });
  it('only emits in-scope action types', () => {
    const allowed = new Set([
      'setVariable', 'increaseVariableByNumber', 'decreaseVariableByNumber',
      'condition', 'repeat', 'for', 'log', 'comment',
    ]);
    for (let s = 0; s < 30; s++) {
      const walk = (as: any[]) => {
        for (const a of as) {
          expect(allowed.has(a.type)).toBe(true);
          for (const k of ['actions', 'then', 'else']) if (Array.isArray(a[k])) walk(a[k]);
        }
      };
      walk(generate(s).actions);
    }
  });
});
