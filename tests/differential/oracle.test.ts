// packages/engine/tests/differential/oracle.test.ts
import { describe, it, expect } from 'vitest';
import { diffTraces, assertTracesEqual } from './oracle';
import type { Trace } from './types';

const base: Trace = { vars: { a: 1 }, outputLog: [1, 2], flow: ['enter:repeat'] };

describe('diffTraces', () => {
  it('returns null when equal', () => {
    expect(diffTraces(base, { vars: { a: 1 }, outputLog: [1, 2], flow: ['enter:repeat'] })).toBeNull();
  });
  it('reports a var mismatch with both values', () => {
    const msg = diffTraces(base, { ...base, vars: { a: 2 } });
    expect(msg).toContain('vars.a');
    expect(msg).toContain('taro:');
    expect(msg).toContain('ts:');
  });
  it('reports first differing output log index', () => {
    const msg = diffTraces(base, { ...base, outputLog: [1, 9] });
    expect(msg).toContain('outputLog[1]');
  });
  it('reports first differing flow step', () => {
    const msg = diffTraces(base, { ...base, flow: ['enter:while'] });
    expect(msg).toContain('flow[0]');
  });
});

describe('assertTracesEqual', () => {
  it('throws on mismatch with context', () => {
    expect(() =>
      assertTracesEqual('seed:42', { ...base }, { ...base, vars: { a: 2 } }, base),
    ).toThrow(/seed:42/);
  });
  it('does not throw when equal', () => {
    expect(() => assertTracesEqual('ok', base, base, base)).not.toThrow();
  });
});
