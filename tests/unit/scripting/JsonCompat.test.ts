import { describe, it, expect } from 'vitest';
import { JsonCompat } from '../../../engine/core/scripting/JsonCompat';

describe('JsonCompat', () => {
  it('transpiles sendChatMessage', () => {
    const js = JsonCompat.transpile({
      type: 'sendChatMessage',
      message: { function: 'string', value: 'hello' },
    });
    expect(js).toContain("world.chat('hello')");
  });

  it('transpiles condition', () => {
    const js = JsonCompat.transpile({
      type: 'condition',
      operator: 'AND',
      conditions: [{
        operandA: { function: 'getEntityAttribute', entity: { function: 'thisEntity' }, key: 'health' },
        operator: 'greaterThan',
        operandB: { function: 'number', value: 50 },
      }],
      then: [{ type: 'sendChatMessage', message: { function: 'string', value: 'alive' } }],
    });
    expect(js).toContain("self.attr('health') > 50");
    expect(js).toContain("world.chat('alive')");
  });

  it('transpiles destroyEntity', () => {
    const js = JsonCompat.transpile({
      type: 'destroyEntity',
      entity: { function: 'thisEntity' },
    });
    expect(js).toContain('self.destroy()');
  });

  it('transpiles setEntityAttribute', () => {
    const js = JsonCompat.transpile({
      type: 'setEntityAttribute',
      entity: { function: 'thisEntity' },
      attributeType: 'health',
      value: { function: 'number', value: 100 },
    });
    expect(js).toContain("self.attr('health', 100)");
  });

  it('handles unknown actions gracefully', () => {
    const js = JsonCompat.transpile({ type: 'unknownAction' });
    expect(js).toContain('Unknown action');
  });

  it('transpiles multiple actions', () => {
    const js = JsonCompat.transpile([
      { type: 'sendChatMessage', message: { function: 'string', value: 'a' } },
      { type: 'sendChatMessage', message: { function: 'string', value: 'b' } },
    ]);
    expect(js).toContain("world.chat('a')");
    expect(js).toContain("world.chat('b')");
  });

  it('transpiles concat operand', () => {
    const js = JsonCompat.transpile({
      type: 'sendChatMessage',
      message: {
        function: 'concat',
        items: [
          'HP: ',
          { function: 'getEntityAttribute', entity: { function: 'thisEntity' }, key: 'health' },
        ],
      },
    });
    expect(js).toContain("'HP: ' + self.attr('health')");
  });
});
