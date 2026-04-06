import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScriptEngine } from '../../../engine/core/scripting/ScriptEngine';
import { Engine } from '../../../engine/core/Engine';

describe('ScriptEngine', () => {
  let engine: Engine;

  beforeEach(() => {
    Engine.reset();
    engine = Engine.instance();
  });

  afterEach(() => {
    Engine.reset();
  });

  it('loads and executes script', () => {
    const se = new ScriptEngine(engine);
    se.load({
      combat: {
        name: 'Combat',
        triggers: ['attack'],
        actions: [{ type: 'setVariable', variableName: 'attacked', value: true }],
      },
    });
    expect(se.scriptCount).toBe(1);
  });

  it('script triggers fire when triggered', () => {
    const se = new ScriptEngine(engine);
    se.load({
      test: {
        name: 'Test',
        triggers: ['ping'],
        actions: [{ type: 'setVariable', variableName: 'pinged', value: true }],
      },
    });
    se.trigger('ping');
    expect(se.variables.getGlobal('pinged')).toBe(true);
  });

  it('scriptCount tracks loaded scripts', () => {
    const se = new ScriptEngine(engine);
    se.load({
      ticker: {
        name: 'Ticker',
        triggers: ['tick'],
        actions: [],
      },
    });
    expect(se.scriptCount).toBe(1);
  });

  it('load replaces previous scripts', () => {
    const se = new ScriptEngine(engine);
    se.load({ a: { name: 'A', triggers: [], actions: [] } });
    expect(se.scriptCount).toBe(1);
    se.load({});
    expect(se.scriptCount).toBe(0);
  });

  it('reset clears variables', () => {
    const se = new ScriptEngine(engine);
    se.variables.setGlobal('x', 1);
    se.reset();
    expect(se.variables.getGlobal('x')).toBeUndefined();
  });

  it('scripts with multiple triggers register all', () => {
    const se = new ScriptEngine(engine);
    se.load({
      multi: {
        name: 'Multi',
        triggers: ['event1', 'event2'],
        actions: [{ type: 'setVariable', variableName: 'fired', value: true }],
      },
    });
    se.trigger('event1');
    expect(se.variables.getGlobal('fired')).toBe(true);
    se.variables.setGlobal('fired', false);
    se.trigger('event2');
    expect(se.variables.getGlobal('fired')).toBe(true);
  });
});
