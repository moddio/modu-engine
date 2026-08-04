// packages/engine/tests/differential/caseAdapter.test.ts
import { describe, it, expect } from 'vitest';
import { adaptActions } from './caseAdapter';

describe('adaptActions', () => {
  it('mirrors variableName -> variable on increase/decrease (deep)', () => {
    const out = adaptActions([
      { type: 'increaseVariableByNumber', variableName: 'score', number: 5 },
      {
        type: 'repeat',
        count: 2,
        actions: [{ type: 'decreaseVariableByNumber', variableName: 'hp', number: 1 }],
      },
    ]);
    expect(out[0]).toMatchObject({ variableName: 'score', variable: 'score' });
    expect((out[1].actions as any[])[0]).toMatchObject({ variableName: 'hp', variable: 'hp' });
  });

  it('does not mutate the input', () => {
    const input = [{ type: 'increaseVariableByNumber', variableName: 'x', number: 1 }];
    adaptActions(input);
    expect(input[0]).not.toHaveProperty('variable');
  });

  it('leaves unrelated actions untouched', () => {
    const out = adaptActions([{ type: 'setVariable', variableName: 'a', value: 1 }]);
    expect(out[0]).toEqual({ type: 'setVariable', variableName: 'a', value: 1 });
  });
});
