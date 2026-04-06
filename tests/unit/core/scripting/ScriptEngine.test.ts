import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Engine } from '../../../../engine/core/Engine';
import { ScriptEngine } from '../../../../engine/core/scripting/ScriptEngine';

describe('ScriptEngine', () => {
  let engine: Engine;
  let se: ScriptEngine;

  beforeEach(() => {
    Engine.reset();
    engine = Engine.instance();
    se = new ScriptEngine(engine);
  });

  afterEach(() => {
    Engine.reset();
  });

  it('load scripts and count', () => {
    se.load({
      s1: { name: 'A', triggers: ['gameStart'], actions: [] },
      s2: { name: 'B', triggers: ['unitDies'], actions: [] },
    });
    expect(se.scriptCount).toBe(2);
  });

  it('trigger fires matching scripts', () => {
    se.load({
      s1: {
        name: 'Init',
        triggers: ['gameStart'],
        actions: [{ type: 'setVariable', variableName: 'started', value: true }],
      },
    });
    se.trigger('gameStart');
    expect(se.variables.getGlobal('started')).toBe(true);
  });

  it('trigger passes context as triggeredBy', () => {
    se.load({
      s1: {
        name: 'UnitScript',
        triggers: ['unitCreated'],
        actions: [
          {
            type: 'setVariable',
            variableName: 'lastUnit',
            value: { function: 'getTriggeringUnit' },
          },
        ],
      },
    });
    se.trigger('unitCreated', { unitId: 'u99' });
    expect(se.variables.getGlobal('lastUnit')).toBe('u99');
  });

  it('loadVariables initializes globals', () => {
    se.loadVariables({
      score: { value: 0, type: 'number' },
      name: { value: 'Test', type: 'string' },
    });
    expect(se.variables.getGlobal('score')).toBe(0);
    expect(se.variables.getGlobal('name')).toBe('Test');
  });

  it('reset clears variables', () => {
    se.variables.setGlobal('x', 1);
    se.reset();
    expect(se.variables.getGlobal('x')).toBeUndefined();
  });

  it('runScript by ID', () => {
    se.load({
      s1: {
        name: 'DirectRun',
        triggers: [],
        actions: [{ type: 'setVariable', variableName: 'ran', value: true }],
      },
    });
    se.runScript('s1');
    expect(se.variables.getGlobal('ran')).toBe(true);
  });

  it('runScript with unknown ID does nothing', () => {
    se.runScript('nonexistent');
    // Should not throw
  });

  it('trigger with no matching scripts does nothing', () => {
    se.load({});
    se.trigger('nothingHere');
    // Should not throw
  });

  it('multiple scripts fire on same trigger', () => {
    se.load({
      s1: {
        name: 'A',
        triggers: ['tick'],
        actions: [{ type: 'setVariable', variableName: 'a', value: 1 }],
      },
      s2: {
        name: 'B',
        triggers: ['tick'],
        actions: [{ type: 'setVariable', variableName: 'b', value: 2 }],
      },
    });
    se.trigger('tick');
    expect(se.variables.getGlobal('a')).toBe(1);
    expect(se.variables.getGlobal('b')).toBe(2);
  });
});
