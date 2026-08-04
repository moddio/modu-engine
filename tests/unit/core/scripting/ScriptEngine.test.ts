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

  it('per-entity-type script only runs for entities of that type', async () => {
    const { Unit } = await import('../../../../engine/core/game/Unit');
    // Two unit types, each with their own entityCreated handler.
    se.loadEntityTypeScripts('unitTypes', {
      fighter: {
        scripts: {
          onCreate: {
            triggers: [{ type: 'entityCreated' }],
            actions: [{ type: 'setVariable', variableName: 'fighterCreated', value: true }],
          },
        },
      },
      goblin: {
        scripts: {
          onCreate: {
            triggers: [{ type: 'entityCreated' }],
            actions: [{ type: 'setVariable', variableName: 'goblinCreated', value: true }],
          },
        },
      },
    });

    // Spawn a fighter — only the fighter handler should run.
    const u = new Unit('u1', { name: 'f', type: 'fighter', health: 100, maxHealth: 100, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    u.mount(engine.root);
    se.trigger('entityCreated', { unitId: 'u1' });

    expect(se.variables.getGlobal('fighterCreated')).toBe(true);
    expect(se.variables.getGlobal('goblinCreated')).toBeUndefined();
  });

  it('top-level scripts (no parent) always run regardless of entity type', async () => {
    const { Unit } = await import('../../../../engine/core/game/Unit');
    se.load({
      anyEntity: {
        name: 'any',
        triggers: ['entityCreated'],
        actions: [{ type: 'setVariable', variableName: 'globalRan', value: true }],
      },
    });
    const u = new Unit('u1', { name: 'g', type: 'goblin', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    u.mount(engine.root);
    se.trigger('entityCreated', { unitId: 'u1' });

    expect(se.variables.getGlobal('globalRan')).toBe(true);
  });

  it('getTriggeringRegion resolver returns the region passed in trigger context', () => {
    const region = { x: 10, y: 20, width: 100, height: 100 };
    se.loadEntityTypeScripts('unitTypes', {
      fighter: {
        scripts: {
          onLeave: {
            triggers: [{ type: 'entityLeavesRegion' }],
            actions: [{
              type: 'setVariable',
              variableName: 'leftRegion',
              value: { function: 'getTriggeringRegion' },
            }],
          },
        },
      },
    });

    // Manually create a unit of type 'fighter' and trigger.
    return import('../../../../engine/core/game/Unit').then(({ Unit }) => {
      const u = new Unit('u1', { name: 'f', type: 'fighter', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
      u.mount(engine.root);
      se.trigger('entityLeavesRegion', { unitId: 'u1', regionId: 'arena', region });
      expect(se.variables.getGlobal('leftRegion')).toBe(region); // identity
    });
  });

  it('per-type script does not run when triggering entity has different type', async () => {
    const { Unit } = await import('../../../../engine/core/game/Unit');
    se.loadEntityTypeScripts('unitTypes', {
      fighter: {
        scripts: {
          onWall: {
            triggers: [{ type: 'entityTouchesWall' }],
            actions: [{ type: 'setVariable', variableName: 'fighterHitWall', value: true }],
          },
        },
      },
    });
    const u = new Unit('u1', { name: 'g', type: 'goblin', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    u.mount(engine.root);
    se.trigger('entityTouchesWall', { unitId: 'u1' });
    expect(se.variables.getGlobal('fighterHitWall')).toBeUndefined();
  });

  // Per-unitType `secondTick` (and any other context-less global trigger) must fan out across
  // all live units of that type. Karmaslayers has 39 such scripts; without fan-out they never fire.
  it('global trigger fans out per-type scripts across all live entities of that type', async () => {
    const { Unit } = await import('../../../../engine/core/game/Unit');
    se.loadEntityTypeScripts('unitTypes', {
      fighter: {
        scripts: {
          tick: {
            triggers: [{ type: 'secondTick' }],
            actions: [
              { type: 'increaseVariableByNumber', variableName: 'fighterTicks', number: 1 },
            ],
          },
        },
      },
      goblin: {
        scripts: {
          tick: {
            triggers: [{ type: 'secondTick' }],
            actions: [
              { type: 'increaseVariableByNumber', variableName: 'goblinTicks', number: 1 },
            ],
          },
        },
      },
    });
    se.variables.setGlobal('fighterTicks', 0);
    se.variables.setGlobal('goblinTicks', 0);

    // Two fighters, one goblin.
    const f1 = new Unit('f1', { name: 'f', type: 'fighter', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    const f2 = new Unit('f2', { name: 'f', type: 'fighter', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    const g1 = new Unit('g1', { name: 'g', type: 'goblin', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    f1.mount(engine.root);
    f2.mount(engine.root);
    g1.mount(engine.root);

    se.trigger('secondTick'); // no entity context — global tick

    expect(se.variables.getGlobal('fighterTicks')).toBe(2);
    expect(se.variables.getGlobal('goblinTicks')).toBe(1);
  });

  // End-to-end: secondTick → top-level script → spawnItem action → item:spawn event.
  // Mirrors the karmaslayers "every second - actions" script (top-level, secondTick-triggered).
  it('top-level secondTick runs spawnItem actions and emits item:spawn', () => {
    se.load({
      everySecond: {
        name: 'every second - actions',
        triggers: ['secondTick'],
        actions: [
          { type: 'spawnItem', itemType: 'coin', position: { x: 100, y: 200 } },
        ],
      },
    });
    const events: Array<unknown[]> = [];
    engine.events.on('item:spawn', (...args: unknown[]) => events.push(args));
    se.trigger('secondTick');
    expect(events.length).toBe(1);
    expect(events[0]).toEqual(['coin', { x: 100, y: 200 }]);
  });

  // Per-type `thisEntity` must resolve to the per-iteration unit during fan-out so
  // taro scripts that read `{function: thisEntity}` get the right unit each pass.
  it('global trigger fan-out binds thisEntity per entity', async () => {
    const { Unit } = await import('../../../../engine/core/game/Unit');
    se.loadEntityTypeScripts('unitTypes', {
      fighter: {
        scripts: {
          tick: {
            triggers: [{ type: 'secondTick' }],
            actions: [
              {
                type: 'setVariable',
                variableName: 'lastTickedUnit',
                value: { function: 'thisEntity' },
              },
            ],
          },
        },
      },
    });
    const u = new Unit('only', { name: 'f', type: 'fighter', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    u.mount(engine.root);
    se.trigger('secondTick');
    expect(se.variables.getGlobal('lastTickedUnit')).toBe('only');
  });
});
