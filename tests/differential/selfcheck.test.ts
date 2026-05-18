// packages/engine/tests/differential/selfcheck.test.ts
import { describe, it, expect } from 'vitest';
import { diffTraces } from './oracle';
import { runTsCase } from './tsHarness';
import { taroAvailable } from './taroHarness';
import type { Trace } from './types';

describe('harness self-check', () => {
  it('oracle DETECTS an intentional divergence (guards against a no-op gate)', () => {
    const a: Trace = { vars: { x: 1 }, outputLog: [], flow: [] };
    const b: Trace = { vars: { x: 2 }, outputLog: [], flow: [] };
    expect(diffTraces(a, b)).not.toBeNull();
  });

  it('a known-equal trivial case round-trips through the TS harness', () => {
    const t = runTsCase({
      name: 'trivial',
      initialVars: { x: { value: 0, type: 'number' } },
      actions: [{ type: 'setVariable', variableName: 'x', value: 1 }],
    });
    expect(t.vars).toEqual({ x: 1 });
  });

  it('taroAvailable() is a clean boolean (skip path never throws)', () => {
    expect(() => taroAvailable()).not.toThrow();
    expect(typeof taroAvailable()).toBe('boolean');
  });
});
