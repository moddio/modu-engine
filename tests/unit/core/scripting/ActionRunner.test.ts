import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Engine } from '../../../../engine/core/Engine';
import { ActionRunner } from '../../../../engine/core/scripting/ActionRunner';
import { VariableStore } from '../../../../engine/core/scripting/VariableStore';

describe('ActionRunner', () => {
  let engine: Engine;
  let vars: VariableStore;
  let runner: ActionRunner;

  beforeEach(() => {
    Engine.reset();
    engine = Engine.instance();
    vars = new VariableStore();
    runner = new ActionRunner(engine, vars);
  });

  afterEach(() => {
    Engine.reset();
  });

  it('setVariable action', () => {
    runner.run([{ type: 'setVariable', variableName: 'score', value: 42 }]);
    expect(vars.getGlobal('score')).toBe(42);
  });

  it('increaseVariableByNumber', () => {
    vars.setGlobal('score', 10);
    runner.run([{ type: 'increaseVariableByNumber', variableName: 'score', number: 5 }]);
    expect(vars.getGlobal('score')).toBe(15);
  });

  it('decreaseVariableByNumber', () => {
    vars.setGlobal('score', 10);
    runner.run([{ type: 'decreaseVariableByNumber', variableName: 'score', number: 3 }]);
    expect(vars.getGlobal('score')).toBe(7);
  });

  it('condition action with then branch', () => {
    runner.run([
      {
        type: 'condition',
        conditions: { operator: '==', operandA: 1, operandB: 1 },
        then: [{ type: 'setVariable', variableName: 'branch', value: 'then' }],
        else: [{ type: 'setVariable', variableName: 'branch', value: 'else' }],
      },
    ]);
    expect(vars.getGlobal('branch')).toBe('then');
  });

  it('condition action with else branch', () => {
    runner.run([
      {
        type: 'condition',
        conditions: { operator: '==', operandA: 1, operandB: 2 },
        then: [{ type: 'setVariable', variableName: 'branch', value: 'then' }],
        else: [{ type: 'setVariable', variableName: 'branch', value: 'else' }],
      },
    ]);
    expect(vars.getGlobal('branch')).toBe('else');
  });

  it('repeat action', () => {
    vars.setGlobal('counter', 0);
    runner.run([
      {
        type: 'repeat',
        count: 5,
        actions: [{ type: 'increaseVariableByNumber', variableName: 'counter', number: 1 }],
      },
    ]);
    expect(vars.getGlobal('counter')).toBe(5);
  });

  it('break stops loop', () => {
    vars.setGlobal('counter', 0);
    runner.run([
      {
        type: 'repeat',
        count: 10,
        actions: [
          { type: 'increaseVariableByNumber', variableName: 'counter', number: 1 },
          {
            type: 'condition',
            conditions: { operator: '>=', operandA: { function: 'getVariable', variableName: 'counter' }, operandB: 3 },
            then: [{ type: 'break' }],
            else: [],
          },
        ],
      },
    ]);
    expect(vars.getGlobal('counter')).toBe(3);
  });

  it('return exits script', () => {
    runner.run([
      { type: 'setVariable', variableName: 'a', value: 1 },
      { type: 'return' },
      { type: 'setVariable', variableName: 'b', value: 2 },
    ]);
    expect(vars.getGlobal('a')).toBe(1);
    expect(vars.getGlobal('b')).toBeUndefined();
  });

  it('comment is no-op', () => {
    const result = runner.run([{ type: 'comment', text: 'This is a comment' }]);
    expect(result).toBeUndefined();
  });

  it('disabled actions are skipped', () => {
    runner.run([
      { type: 'setVariable', variableName: 'x', value: 1, disabled: true },
    ]);
    expect(vars.getGlobal('x')).toBeUndefined();
  });

  it('resolves getVariable function references', () => {
    vars.setGlobal('hp', 100);
    runner.run([
      {
        type: 'setVariable',
        variableName: 'result',
        value: { function: 'getVariable', variableName: 'hp' },
      },
    ]);
    expect(vars.getGlobal('result')).toBe(100);
  });

  it('resolves getTriggeringUnit', () => {
    runner.run(
      [
        {
          type: 'setVariable',
          variableName: 'unit',
          value: { function: 'getTriggeringUnit' },
        },
      ],
      { triggeredBy: { unitId: 'u42' } },
    );
    expect(vars.getGlobal('unit')).toBe('u42');
  });

  it('resolves getTriggeringPlayer', () => {
    runner.run(
      [
        {
          type: 'setVariable',
          variableName: 'player',
          value: { function: 'getTriggeringPlayer' },
        },
      ],
      { triggeredBy: { playerId: 'p7' } },
    );
    expect(vars.getGlobal('player')).toBe('p7');
  });

  it('calculate function +', () => {
    runner.run([
      {
        type: 'setVariable',
        variableName: 'sum',
        value: { function: 'calculate', items: [{ operator: '+' }, 3, 4] },
      },
    ]);
    expect(vars.getGlobal('sum')).toBe(7);
  });

  it('calculate function -', () => {
    runner.run([
      {
        type: 'setVariable',
        variableName: 'diff',
        value: { function: 'calculate', items: [{ operator: '-' }, 10, 3] },
      },
    ]);
    expect(vars.getGlobal('diff')).toBe(7);
  });

  it('calculate function *', () => {
    runner.run([
      {
        type: 'setVariable',
        variableName: 'prod',
        value: { function: 'calculate', items: [{ operator: '*' }, 6, 7] },
      },
    ]);
    expect(vars.getGlobal('prod')).toBe(42);
  });

  it('calculate function / with division by zero', () => {
    runner.run([
      {
        type: 'setVariable',
        variableName: 'div',
        value: { function: 'calculate', items: [{ operator: '/' }, 10, 0] },
      },
    ]);
    expect(vars.getGlobal('div')).toBe(0);
  });

  it('nested conditions with variable comparisons', () => {
    vars.setGlobal('level', 5);
    vars.setGlobal('xp', 1000);
    runner.run([
      {
        type: 'condition',
        conditions: {
          operator: 'AND',
          operandA: {
            operator: '>=',
            operandA: { function: 'getVariable', variableName: 'level' },
            operandB: 3,
          },
          operandB: {
            operator: '>',
            operandA: { function: 'getVariable', variableName: 'xp' },
            operandB: 500,
          },
        },
        then: [{ type: 'setVariable', variableName: 'qualified', value: true }],
        else: [{ type: 'setVariable', variableName: 'qualified', value: false }],
      },
    ]);
    expect(vars.getGlobal('qualified')).toBe(true);
  });

  it('setEntityVariable and setPlayerVariable', () => {
    runner.run([
      { type: 'setEntityVariable', entity: 'e1', variableName: 'hp', value: 50 },
      { type: 'setPlayerVariable', player: 'p1', variableName: 'score', value: 999 },
    ]);
    expect(vars.getEntityVar('e1', 'hp')).toBe(50);
    expect(vars.getPlayerVar('p1', 'score')).toBe(999);
  });

  it('unknown actions emit scriptAction event', () => {
    let emitted: unknown[] = [];
    engine.events.on('scriptAction', (...args: unknown[]) => {
      emitted = args;
    });
    runner.run([{ type: 'customAction', data: 'test' }]);
    expect(emitted[0]).toBe('customAction');
  });

  it('entity actions emit scriptAction event', () => {
    let emittedType = '';
    engine.events.on('scriptAction', (type: unknown) => {
      emittedType = type as string;
    });
    runner.run([{ type: 'destroyEntity', entity: 'e1' }]);
    expect(emittedType).toBe('destroyEntity');
  });

  it('resolves point {x, y} values', () => {
    vars.setGlobal('posX', 10);
    runner.run([
      {
        type: 'setVariable',
        variableName: 'pos',
        value: { x: { function: 'getVariable', variableName: 'posX' }, y: 20 },
      },
    ]);
    const pos = vars.getGlobal('pos') as { x: number; y: number };
    expect(pos.x).toBe(10);
    expect(pos.y).toBe(20);
  });
});
