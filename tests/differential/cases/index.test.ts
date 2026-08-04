import { describe, it, expect } from 'vitest';
import { loadCases } from './index';

describe('loadCases', () => {
  it('loads all fixtures with required fields', () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(5);
    for (const c of cases) {
      expect(typeof c.name).toBe('string');
      expect(c.initialVars).toBeTypeOf('object');
      expect(Array.isArray(c.actions)).toBe(true);
    }
  });
});
