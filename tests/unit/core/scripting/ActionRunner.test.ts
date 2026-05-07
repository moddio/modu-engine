import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Engine } from '../../../../engine/core/Engine';
import { ActionRunner } from '../../../../engine/core/scripting/ActionRunner';
import { VariableStore } from '../../../../engine/core/scripting/VariableStore';
import { Unit } from '../../../../engine/core/game/Unit';
import { Player } from '../../../../engine/core/game/Player';

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

  it('getEntityAttribute reads attr_<name>.value off the entity', () => {
    const u = new Unit('u1', { name: 'foo', type: 't', health: 100, maxHealth: 100, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    (u.stats as any).attr_health = { value: 42, min: 0, max: 100 };
    u.mount(engine.root);

    runner.run([{
      type: 'setVariable',
      variableName: 'hp',
      value: { function: 'getEntityAttribute', entity: 'u1', attribute: 'health' },
    }]);

    expect(vars.getGlobal('hp')).toBe(42);
  });

  it('getEntityAttribute returns undefined for missing entity (no crash)', () => {
    runner.run([{
      type: 'setVariable',
      variableName: 'hp',
      value: { function: 'getEntityAttribute', entity: 'nope', attribute: 'health' },
    }]);
    expect(vars.getGlobal('hp')).toBeUndefined();
  });

  it('getMouseCursorPosition reads from triggering player\'s selected unit, scaled to pixels', () => {
    runner.mapTilePx = 32;
    const player = new Player('p1', { name: 'p', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: ['u1'], selectedUnitId: 'u1', cameraTrackedUnitId: 'u1' });
    player.mount(engine.root);
    const u = new Unit('u1', { name: 'foo', type: 't', health: 100, maxHealth: 100, speed: 0, ownerId: 'p1', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    (u as any)._mousePosition = { x: 4, y: 5 }; // tile units → 128, 160 px
    u.mount(engine.root);

    runner.run([{
      type: 'setVariable',
      variableName: 'mouse',
      value: { function: 'getMouseCursorPosition' },
    }], { triggeredBy: { playerId: 'p1' } });

    expect(vars.getGlobal('mouse')).toEqual({ x: 128, y: 160 });
  });

  it('getMouseCursorPosition falls back to origin when no player context', () => {
    runner.run([{
      type: 'setVariable',
      variableName: 'mouse',
      value: { function: 'getMouseCursorPosition' },
    }]);
    expect(vars.getGlobal('mouse')).toEqual({ x: 0, y: 0 });
  });

  it('setVelocityOfEntityXY emits physics:setVelocity with vx, vy', () => {
    let captured: unknown[] = [];
    engine.events.on('physics:setVelocity', (...args: unknown[]) => { captured = args; });
    runner.run([{
      type: 'setVelocityOfEntityXY',
      entity: 'u1',
      velocity: { x: 5, y: -3 },
    }]);
    expect(captured).toEqual(['u1', 5, -3]);
  });

  it('aiAttackUnit and aiMoveToPosition emit ai:* events', () => {
    const events: Array<{ name: string; args: unknown[] }> = [];
    engine.events.on('ai:attackUnit', (...args: unknown[]) => events.push({ name: 'ai:attackUnit', args }));
    engine.events.on('ai:moveToPosition', (...args: unknown[]) => events.push({ name: 'ai:moveToPosition', args }));
    runner.run([
      { type: 'aiAttackUnit', unit: 'u1', targetUnit: 'u2' },
      { type: 'aiMoveToPosition', unit: 'u3', position: { x: 10, y: 20 } },
    ]);
    expect(events[0].name).toBe('ai:attackUnit');
    expect(events[0].args).toEqual(['u1', 'u2']);
    expect(events[1].name).toBe('ai:moveToPosition');
    expect(events[1].args).toEqual(['u3', { x: 10, y: 20 }]);
  });

  it('forAllEntities iterates resolved id list with selectedEntity binding', () => {
    vars.setGlobal('count', 0);
    runner.run([{
      type: 'forAllEntities',
      // Static array; resolves through _resolveValue. Since plain arrays
      // pass through unchanged, this exercises the iteration loop directly.
      entityGroup: ['e1', 'e2', 'e3'],
      actions: [
        { type: 'increaseVariableByNumber', variableName: 'count', number: 1 },
        // Capture each iteration's selectedEntity into a per-id flag.
        {
          type: 'condition',
          conditions: { operator: '==', operandA: { function: 'selectedEntity' }, operandB: 'e2' },
          then: [{ type: 'setVariable', variableName: 'sawE2', value: true }],
        },
      ],
    }]);
    expect(vars.getGlobal('count')).toBe(3);
    expect(vars.getGlobal('sawE2')).toBe(true);
  });

  it('forAllRegions iterates allRegions and binds selectedRegion', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 100, y: 100, width: 5, height: 5 };
    vars.setGlobal('arena', a, 'region');
    vars.setGlobal('shop', b, 'region');
    vars.setGlobal('hits', 0);

    runner.run([{
      type: 'forAllRegions',
      regionGroup: { function: 'allRegions' },
      actions: [
        { type: 'increaseVariableByNumber', variableName: 'hits', number: 1 },
        {
          type: 'condition',
          // selectedRegion's name should be derivable via nameOfRegion.
          conditions: { operator: '==', operandA: { function: 'nameOfRegion', region: { function: 'selectedRegion' } }, operandB: 'shop' },
          then: [{ type: 'setVariable', variableName: 'sawShop', value: true }],
        },
      ],
    }]);
    expect(vars.getGlobal('hits')).toBe(2);
    expect(vars.getGlobal('sawShop')).toBe(true);
  });

  it('getEntityPosition uses runtime mapTilePx not hardcoded 64', () => {
    const u = new Unit('u1', { name: 'f', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    u.position.x = 10; u.position.z = 5;
    u.mount(engine.root);
    runner.mapTilePx = 16;
    runner.run([{ type: 'setVariable', variableName: 'p', value: { function: 'getEntityPosition', entity: 'u1' } }]);
    // Karmaslayers tilewidth=16 → expect (160, 80), not (640, 320).
    expect(vars.getGlobal('p')).toEqual({ x: 160, y: 80 });
  });

  it('angleBetweenPositions adds π/2 (taro convention: 0 = up)', () => {
    runner.run([{
      type: 'setVariable', variableName: 'a',
      value: { function: 'angleBetweenPositions', positionA: { x: 0, y: 0 }, positionB: { x: 0, y: 1 } },
    }]);
    // atan2(1,0) = π/2; +π/2 = π. Pointing straight down on screen y-axis.
    expect(vars.getGlobal('a')).toBeCloseTo(Math.PI, 5);
  });

  it('getPositionInFrontOfPosition subtracts π/2 from angle', () => {
    // angle 0, distance 5 → with -π/2 offset, point (5*cos(-π/2), 5*sin(-π/2)) = (0, -5).
    runner.run([{
      type: 'setVariable', variableName: 'p',
      value: { function: 'getPositionInFrontOfPosition', position: { x: 0, y: 0 }, distance: 5, angle: 0 },
    }]);
    const p = vars.getGlobal('p') as { x: number; y: number };
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(-5, 5);
  });

  it('getLastCreatedProjectile tracks via entityCreatedGlobal with projectileId', () => {
    engine.events.emit('entityCreatedGlobal', { entityId: 'p1', projectileId: 'p1' });
    runner.run([{ type: 'setVariable', variableName: 'lp', value: { function: 'getLastCreatedProjectile' } }]);
    expect(vars.getGlobal('lp')).toBe('p1');
  });

  // The legacy editor authors `getSourceItemOfProjectile` / `getSourceUnitOfProjectile`
  // with the projectile reference under the `entity:` key (Karmaslayers' global
  // `unitTouchesProjectile` damage script does this throughout). Reading only
  // `obj.projectile` made the entire fighter-attacks-mob branch resolve to
  // undefined, gating off the fallthrough damage and leaving every basic-weapon
  // hit dealing 0 damage. Both shapes must work.
  it('getSourceItemOfProjectile / getSourceUnitOfProjectile accept entity: key (editor shape)', () => {
    const proj = engine.spawn('p1');
    proj.category = 'projectile';
    (proj as any).stats = { sourceId: 'inv_42', sourceUnitId: 'u_99' };
    runner.run([
      { type: 'setVariable', variableName: 'srcItem', value: { function: 'getSourceItemOfProjectile', entity: 'p1' } },
      { type: 'setVariable', variableName: 'srcUnit', value: { function: 'getSourceUnitOfProjectile', entity: 'p1' } },
    ]);
    expect(vars.getGlobal('srcItem')).toBe('inv_42');
    expect(vars.getGlobal('srcUnit')).toBe('u_99');
  });

  it('entityWidth / entityHeight read from stats.bodies.default', () => {
    const u = new Unit('u1', { name: 'f', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    (u.stats as any).bodies = { default: { width: 48, height: 96 } };
    u.mount(engine.root);
    runner.run([
      { type: 'setVariable', variableName: 'w', value: { function: 'entityWidth', entity: 'u1' } },
      { type: 'setVariable', variableName: 'h', value: { function: 'entityHeight', entity: 'u1' } },
    ]);
    expect(vars.getGlobal('w')).toBe(48);
    expect(vars.getGlobal('h')).toBe(96);
  });

  it('entityWidth / entityHeight multiply by stats.scaleBody (taro parity)', () => {
    const u = new Unit('u1', { name: 'f', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    (u.stats as any).bodies = { default: { width: 32, height: 32 } };
    (u.stats as any).scaleBody = 2.5;
    u.mount(engine.root);
    runner.run([
      { type: 'setVariable', variableName: 'w', value: { function: 'entityWidth', entity: 'u1' } },
      { type: 'setVariable', variableName: 'h', value: { function: 'entityHeight', entity: 'u1' } },
    ]);
    expect(vars.getGlobal('w')).toBe(80);
    expect(vars.getGlobal('h')).toBe(80);
  });

  it('getRandomItemTypeFromItemTypeGroup honors probability weighting', () => {
    // Stub Math.random so the weighted pick is deterministic.
    const orig = Math.random;
    try {
      // total = 10. 0.05 -> r=0.5 (under "rare":1), 0.55 -> r=5.5 (under "common":9)
      vars.setGlobal('grp', { rare: { probability: 1 }, common: { probability: 9 } }, 'itemTypeGroup');
      Math.random = () => 0.05;
      runner.run([{ type: 'setVariable', variableName: 'pick',
        value: { function: 'getRandomItemTypeFromItemTypeGroup',
                 itemTypeGroup: { function: 'getVariable', variableName: 'grp' } } }]);
      expect(vars.getGlobal('pick')).toBe('rare');

      Math.random = () => 0.55;
      runner.run([{ type: 'setVariable', variableName: 'pick',
        value: { function: 'getRandomItemTypeFromItemTypeGroup',
                 itemTypeGroup: { function: 'getVariable', variableName: 'grp' } } }]);
      expect(vars.getGlobal('pick')).toBe('common');
    } finally {
      Math.random = orig;
    }
  });

  it('getRandomItemTypeFromItemTypeGroup falls back to uniform when weights are absent', () => {
    const orig = Math.random;
    try {
      // No probabilities — uniform pick over keys.
      vars.setGlobal('grp', { a: {}, b: {} }, 'itemTypeGroup');
      Math.random = () => 0;
      runner.run([{ type: 'setVariable', variableName: 'pick',
        value: { function: 'getRandomItemTypeFromItemTypeGroup',
                 itemTypeGroup: { function: 'getVariable', variableName: 'grp' } } }]);
      expect(vars.getGlobal('pick')).toBe('a');
    } finally {
      Math.random = orig;
    }
  });

  it('getValueOfEntityVariable / getValueOfPlayerVariable accept legacy nested {variable:{key}} shape', () => {
    // Modu serializes a flat `variableName` field, but the legacy editor still
    // outputs taro's nested `variable.variable.key` shape — both must work.
    const u = new Unit('u1', { name: 'f', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    u.mount(engine.root);
    const p = new Player('p1', { name: 'q', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
    p.mount(engine.root);
    vars.setEntityVar('u1', 'hp', 42);
    vars.setPlayerVar('p1', 'kills', 7);
    runner.run([
      { type: 'setVariable', variableName: 'flat',
        value: { function: 'getValueOfEntityVariable', entity: 'u1', variableName: 'hp' } },
      { type: 'setVariable', variableName: 'nested',
        value: { function: 'getValueOfEntityVariable', entity: 'u1',
                 variable: { function: 'getEntityVariable', variable: { key: 'hp' } } } },
      { type: 'setVariable', variableName: 'pflat',
        value: { function: 'getValueOfPlayerVariable', player: 'p1', variableName: 'kills' } },
      { type: 'setVariable', variableName: 'pnested',
        value: { function: 'getValueOfPlayerVariable', player: 'p1',
                 variable: { function: 'getPlayerVariable', variable: { key: 'kills' } } } },
    ]);
    expect(vars.getGlobal('flat')).toBe(42);
    expect(vars.getGlobal('nested')).toBe(42);
    expect(vars.getGlobal('pflat')).toBe(7);
    expect(vars.getGlobal('pnested')).toBe(7);
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

  // --- C1: direct movement ---
  it('startMovingUnit{Up,Down,Left,Right} emits unit:startMove with direction', () => {
    const events: Array<{ args: unknown[] }> = [];
    engine.events.on('unit:startMove', (...args: unknown[]) => events.push({ args }));
    runner.run([
      { type: 'startMovingUnitUp', unit: 'u1' },
      { type: 'startMovingUnitDown', unit: 'u1' },
      { type: 'startMovingUnitLeft', unit: 'u1' },
      { type: 'startMovingUnitRight', unit: 'u1' },
    ]);
    expect(events.map(e => e.args)).toEqual([
      ['u1', 'up'], ['u1', 'down'], ['u1', 'left'], ['u1', 'right'],
    ]);
  });

  it('stopMovingUnit / X / Y emits unit:stopMove with axis', () => {
    const events: Array<{ args: unknown[] }> = [];
    engine.events.on('unit:stopMove', (...args: unknown[]) => events.push({ args }));
    runner.run([
      { type: 'stopMovingUnit', unit: 'u1' },
      { type: 'stopMovingUnitX', unit: 'u1' },
      { type: 'stopMovingUnitY', unit: 'u1' },
    ]);
    expect(events.map(e => e.args)).toEqual([
      ['u1', 'both'], ['u1', 'x'], ['u1', 'y'],
    ]);
  });

  it('enableAI / disableAI emits ai:enabled with flag', () => {
    const events: Array<{ args: unknown[] }> = [];
    engine.events.on('ai:enabled', (...args: unknown[]) => events.push({ args }));
    runner.run([
      { type: 'enableAI', unit: 'u1' },
      { type: 'disableAI', unit: 'u1' },
    ]);
    expect(events.map(e => e.args)).toEqual([['u1', true], ['u1', false]]);
  });

  // --- C2: velocity variants ---
  it('applyForceOnEntityXYRelative emits physics:applyForceRelative with fx, fy', () => {
    let captured: unknown[] = [];
    engine.events.on('physics:applyForceRelative', (...args: unknown[]) => { captured = args; });
    runner.run([{ type: 'applyForceOnEntityXYRelative', entity: 'u1', force: { x: 2, y: -1 } }]);
    expect(captured).toEqual(['u1', 2, -1]);
  });

  it('setEntityVelocityAtAngle emits physics:setVelocityAtAngle', () => {
    let captured: unknown[] = [];
    engine.events.on('physics:setVelocityAtAngle', (...args: unknown[]) => { captured = args; });
    runner.run([{ type: 'setEntityVelocityAtAngle', entity: 'u1', speed: 5, angle: 1.5 }]);
    expect(captured).toEqual(['u1', 5, 1.5]);
  });

  it('applyTorqueOnEntity emits physics:applyTorque', () => {
    let captured: unknown[] = [];
    engine.events.on('physics:applyTorque', (...args: unknown[]) => { captured = args; });
    runner.run([{ type: 'applyTorqueOnEntity', entity: 'u1', torque: 3 }]);
    expect(captured).toEqual(['u1', 3]);
  });

  // --- C3: inventory ---
  it('refillAmmo emits item:refillAmmo with item id', () => {
    let captured: unknown[] = [];
    engine.events.on('item:refillAmmo', (...args: unknown[]) => { captured = args; });
    runner.run([{ type: 'refillAmmo', item: 'i1' }]);
    expect(captured).toEqual(['i1']);
  });

  it('setUnitOwner emits unit:setOwner', () => {
    let captured: unknown[] = [];
    engine.events.on('unit:setOwner', (...args: unknown[]) => { captured = args; });
    runner.run([{ type: 'setUnitOwner', unit: 'u1', player: 'p2' }]);
    expect(captured).toEqual(['u1', 'p2']);
  });

  it('selectedInventorySlot returns 1-based currentItemIndex', () => {
    const u = new Unit('u1', { name: 'f', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    (u.stats as any).currentItemIndex = 2;
    u.mount(engine.root);
    runner.run([{ type: 'setVariable', variableName: 's', value: { function: 'selectedInventorySlot', unit: 'u1' } }]);
    expect(vars.getGlobal('s')).toBe(3);
  });

  // --- C4: camera ---
  it('playerCameraSetPitch / Yaw emit camera:setPitch / camera:setYaw', () => {
    const events: Array<{ name: string; args: unknown[] }> = [];
    engine.events.on('camera:setPitch', (...args: unknown[]) => events.push({ name: 'pitch', args }));
    engine.events.on('camera:setYaw', (...args: unknown[]) => events.push({ name: 'yaw', args }));
    runner.run([
      { type: 'playerCameraSetPitch', player: 'p1', angle: 0.5 },
      { type: 'playerCameraSetYaw', player: 'p1', angle: 1.0 },
    ]);
    expect(events).toEqual([
      { name: 'pitch', args: ['p1', 0.5] },
      { name: 'yaw', args: ['p1', 1.0] },
    ]);
  });

  it('setCameraDeadzone emits camera:setDeadzone with width/height', () => {
    let captured: unknown[] = [];
    engine.events.on('camera:setDeadzone', (...args: unknown[]) => { captured = args; });
    runner.run([{ type: 'setCameraDeadzone', player: 'p1', width: 100, height: 80 }]);
    expect(captured).toEqual(['p1', 100, 80]);
  });

  // --- C5: groups ---
  it('addPlayerToPlayerGroup pushes to global variable array', () => {
    runner.run([{
      type: 'addPlayerToPlayerGroup',
      player: 'p1',
      playerGroup: { variableName: 'team' },
    }]);
    runner.run([{
      type: 'addPlayerToPlayerGroup',
      player: 'p2',
      playerGroup: { variableName: 'team' },
    }]);
    expect(vars.getGlobal('team')).toEqual(['p1', 'p2']);
  });

  it('removeUnitFromUnitGroup splices the matching unit', () => {
    vars.setGlobal('squad', ['u1', 'u2', 'u3'], 'unitGroup');
    runner.run([{
      type: 'removeUnitFromUnitGroup',
      unit: 'u2',
      unitGroup: { variableName: 'squad' },
    }]);
    expect(vars.getGlobal('squad')).toEqual(['u1', 'u3']);
  });

  it('addBotPlayer emits player:addBot with name', () => {
    let captured: unknown[] = [];
    engine.events.on('player:addBot', (...args: unknown[]) => { captured = args; });
    runner.run([{ type: 'addBotPlayer', name: 'BotA' }]);
    expect(captured).toEqual(['BotA']);
  });

  // --- C6: lighting ---
  it('setGravity emits world:setGravity with x, y, z', () => {
    let captured: unknown[] = [];
    engine.events.on('world:setGravity', (...args: unknown[]) => { captured = args; });
    runner.run([{ type: 'setGravity', x: 0, y: -9.8, z: 0 }]);
    expect(captured).toEqual([0, -9.8, 0]);
  });

  it('setSkyboxOpacity clamps to [0, 1]', () => {
    const events: Array<unknown[]> = [];
    engine.events.on('renderer:skyboxOpacity', (...args: unknown[]) => { events.push(args); });
    runner.run([
      { type: 'setSkyboxOpacity', opacity: -0.5 },
      { type: 'setSkyboxOpacity', opacity: 0.7 },
      { type: 'setSkyboxOpacity', opacity: 2.0 },
    ]);
    expect(events).toEqual([[0], [0.7], [1]]);
  });

  it('setAmbientLightColor emits renderer:ambientColor', () => {
    let captured: unknown[] = [];
    engine.events.on('renderer:ambientColor', (...args: unknown[]) => { captured = args; });
    runner.run([{ type: 'setAmbientLightColor', color: '#aabbcc' }]);
    expect(captured).toEqual(['#aabbcc']);
  });

  // --- C7: UI ---
  it('addClassToUIElement / removeClassFromUIElement emit ui:elementClass', () => {
    const events: Array<unknown[]> = [];
    engine.events.on('ui:elementClass', (...args: unknown[]) => { events.push(args); });
    runner.run([
      { type: 'addClassToUIElement', elementId: 'box', className: 'hl', player: 'p1' },
      { type: 'removeClassFromUIElement', elementId: 'box', className: 'hl', player: 'p1' },
    ]);
    expect(events).toEqual([
      ['add', 'box', 'hl', 'p1'],
      ['remove', 'box', 'hl', 'p1'],
    ]);
  });

  // --- C8: iteration helpers ---
  it('forAllUnitTypes iterates keys with selectedUnitType binding', () => {
    vars.setGlobal('hits', 0);
    runner.run([{
      type: 'forAllUnitTypes',
      unitTypeGroup: { tA: {}, tB: {}, tC: {} },
      actions: [
        { type: 'increaseVariableByNumber', variableName: 'hits', number: 1 },
        {
          type: 'condition',
          conditions: { operator: '==', operandA: { function: 'selectedUnitType' }, operandB: 'tB' },
          then: [{ type: 'setVariable', variableName: 'sawB', value: true }],
        },
      ],
    }]);
    expect(vars.getGlobal('hits')).toBe(3);
  });

  it('forAllElementsInObject binds selectedElement and selectedElementsKey', () => {
    vars.setGlobal('keys', '');
    runner.run([{
      type: 'forAllElementsInObject',
      object: { a: 1, b: 2 },
      actions: [
        { type: 'setVariable', variableName: 'keys', value: {
          function: 'concat',
          textA: { function: 'getVariable', variableName: 'keys' },
          textB: { function: 'selectedElementsKey' },
        } },
      ],
    }]);
    // concat returns string; both keys should be appended.
    const k = vars.getGlobal('keys') as string;
    expect(k).toContain('a');
    expect(k).toContain('b');
  });

  // --- C9: sensors / raycast ---
  it('renderLineBetweenPositions emits debug:renderLine with from, to, color, duration', () => {
    let captured: unknown[] = [];
    engine.events.on('debug:renderLine', (...args: unknown[]) => { captured = args; });
    runner.run([{
      type: 'renderLineBetweenPositions',
      startPosition: { x: 0, y: 0 },
      endPosition: { x: 5, y: 5 },
      color: '#ff0000',
      duration: 1000,
    }]);
    expect(captured).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }, '#ff0000', 1000]);
  });

  it('showUiTextForEveryone / hideUiTextForEveryone emit broadcast events', () => {
    const events: Array<{ name: string; args: unknown[] }> = [];
    engine.events.on('ui:showTextForEveryone', (...args: unknown[]) => events.push({ name: 'show', args }));
    engine.events.on('ui:hideTextForEveryone', (...args: unknown[]) => events.push({ name: 'hide', args }));
    runner.run([
      { type: 'showUiTextForEveryone', target: 'center-lg', value: 'GAME OVER' },
      { type: 'hideUiTextForEveryone', target: 'center-lg' },
    ]);
    expect(events).toEqual([
      { name: 'show', args: ['center-lg', 'GAME OVER'] },
      { name: 'hide', args: ['center-lg'] },
    ]);
  });

  it('unitSensorRadius reads stats.ai.sensorRadius when no live sensor', () => {
    const u = new Unit('u1', { name: 'f', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
    (u.stats as any).ai = { sensorRadius: 250 };
    u.mount(engine.root);
    runner.run([{ type: 'setVariable', variableName: 'r', value: { function: 'unitSensorRadius', unit: 'u1' } }]);
    expect(vars.getGlobal('r')).toBe(250);
  });

  // --- B1. Additional string functions ---
  describe('B1 string functions', () => {
    const setStr = (name: string, fn: string, params: Record<string, unknown>) => ({
      type: 'setVariable', variableName: name, value: { function: fn, ...params },
    });

    it('stringContains returns true when substring is present', () => {
      runner.run([
        setStr('a', 'stringContains', { string: 'hello world', keyword: 'world' }),
        setStr('b', 'stringContains', { string: 'hello world', keyword: 'xyz' }),
      ]);
      expect(vars.getGlobal('a')).toBe(true);
      expect(vars.getGlobal('b')).toBe(false);
    });

    it('stringContains returns false when input is missing/non-string (no empty-string false-positive)', () => {
      // Naive `String(x ?? '')` would coerce undefined → '' and ''.indexOf('') > -1 → true.
      // We must reject non-string input so a missing variable can't accidentally match.
      runner.run([
        setStr('a', 'stringContains', { string: undefined, keyword: undefined }),
        setStr('b', 'stringContains', { string: undefined, keyword: 'foo' }),
        setStr('c', 'stringContains', { string: 'foo', keyword: undefined }),
      ]);
      expect(vars.getGlobal('a')).toBe(false);
      expect(vars.getGlobal('b')).toBe(false);
      expect(vars.getGlobal('c')).toBe(false);
    });

    it('stringStartsWith / stringEndsWith use sourceString + patternString', () => {
      runner.run([
        setStr('a', 'stringStartsWith', { sourceString: 'foo-bar', patternString: 'foo' }),
        setStr('b', 'stringStartsWith', { sourceString: 'foo-bar', patternString: 'bar' }),
        setStr('c', 'stringEndsWith', { sourceString: 'foo-bar', patternString: 'bar' }),
        setStr('d', 'stringEndsWith', { sourceString: 'foo-bar', patternString: 'foo' }),
      ]);
      expect(vars.getGlobal('a')).toBe(true);
      expect(vars.getGlobal('b')).toBe(false);
      expect(vars.getGlobal('c')).toBe(true);
      expect(vars.getGlobal('d')).toBe(false);
    });

    it('replaceValuesInString does a global regex replace', () => {
      runner.run([setStr('s', 'replaceValuesInString',
        { sourceString: 'a-b-c', matchString: '-', newString: '_' })]);
      expect(vars.getGlobal('s')).toBe('a_b_c');
    });

    it('toUpperCase upper-cases the string', () => {
      runner.run([setStr('s', 'toUpperCase', { string: 'Hi There' })]);
      expect(vars.getGlobal('s')).toBe('HI THERE');
    });

    it('filterString passes the string through unchanged (no chat filter in modu)', () => {
      runner.run([setStr('s', 'filterString', { string: 'damnit' })]);
      expect(vars.getGlobal('s')).toBe('damnit');
    });

    it('getStringArrayLength / getStringArrayElement parse a JSON-array string', () => {
      runner.run([
        setStr('len', 'getStringArrayLength', { string: '["a","b","c"]' }),
        setStr('el',  'getStringArrayElement', { string: '["a","b","c"]', number: 1 }),
      ]);
      expect(vars.getGlobal('len')).toBe(3);
      expect(vars.getGlobal('el')).toBe('b');
    });

    it('insertStringArrayElement / removeStringArrayElement return modified JSON, leaving input alone', () => {
      runner.run([
        setStr('ins', 'insertStringArrayElement', { string: '[1,2]', value: 3 }),
        setStr('rem', 'removeStringArrayElement', { string: '[1,2,3]', number: 1 }),
      ]);
      expect(vars.getGlobal('ins')).toBe('[1,2,3]');
      expect(vars.getGlobal('rem')).toBe('[1,3]');
    });

    it('string-array readers return undefined on bad JSON instead of throwing', () => {
      runner.run([
        setStr('a', 'getStringArrayLength', { string: 'not json' }),
        setStr('b', 'getStringArrayElement', { string: 'not json', number: 0 }),
      ]);
      expect(vars.getGlobal('a')).toBeUndefined();
      expect(vars.getGlobal('b')).toBeUndefined();
    });

    it('substringOf is a slice (taro semantics), not a contains check', () => {
      // Pre-existing modu impl returned `src.includes(pat)` (a boolean) — that's
      // wrong: taro's `substringOf` slices `string.substring(fromIndex, toIndex)`
      // (ParameterComponent.js:2408). Verify clamp + correct slice.
      runner.run([
        setStr('mid',  'substringOf', { string: 'abcdef', fromIndex: 1, toIndex: 4 }),
        setStr('clip', 'substringOf', { string: 'abc',    fromIndex: -5, toIndex: 100 }),
        setStr('empty','substringOf', { string: '',       fromIndex: 0, toIndex: 0 }),
      ]);
      expect(vars.getGlobal('mid')).toBe('bcd');
      expect(vars.getGlobal('clip')).toBe('abc');
      expect(vars.getGlobal('empty')).toBe('');
    });
  });

  // --- B2. Additional math functions ---
  describe('B2 math functions', () => {
    const fn = (name: string, f: string, params: Record<string, unknown>) => ({
      type: 'setVariable', variableName: name, value: { function: f, ...params },
    });

    it('mathRound / mathCeiling / mathSign read from obj.value', () => {
      runner.run([
        fn('r', 'mathRound', { value: 1.4 }),
        fn('c', 'mathCeiling', { value: 1.1 }),
        fn('s', 'mathSign', { value: -7 }),
      ]);
      expect(vars.getGlobal('r')).toBe(1);
      expect(vars.getGlobal('c')).toBe(2);
      expect(vars.getGlobal('s')).toBe(-1);
    });

    it('toRadians / toDegrees use obj.number, round-trip identity', () => {
      runner.run([
        fn('r', 'toRadians', { number: 180 }),
        fn('d', 'toDegrees', { number: Math.PI }),
      ]);
      expect(vars.getGlobal('r')).toBeCloseTo(Math.PI, 5);
      expect(vars.getGlobal('d')).toBeCloseTo(180, 5);
    });

    it('absoluteValueOfNumber and squareRoot work on obj.number', () => {
      runner.run([
        fn('a', 'absoluteValueOfNumber', { number: -9 }),
        fn('s', 'squareRoot', { number: 16 }),
      ]);
      expect(vars.getGlobal('a')).toBe(9);
      expect(vars.getGlobal('s')).toBe(4);
    });

    it('arctan / tan use angle/number params', () => {
      runner.run([
        fn('a', 'arctan', { number: 1 }),
        fn('t', 'tan', { angle: Math.PI / 4 }),
      ]);
      expect(vars.getGlobal('a')).toBeCloseTo(Math.PI / 4, 5);
      expect(vars.getGlobal('t')).toBeCloseTo(1, 5);
    });

    it('lerp interpolates between valueA and valueB by alpha', () => {
      runner.run([
        fn('mid', 'lerp', { valueA: 0, valueB: 10, alpha: 0.5 }),
        fn('end', 'lerp', { valueA: 100, valueB: 200, alpha: 1 }),
      ]);
      expect(vars.getGlobal('mid')).toBe(5);
      expect(vars.getGlobal('end')).toBe(200);
    });

    it('log10 of 1000 is 3', () => {
      runner.run([fn('l', 'log10', { value: 1000 })]);
      expect(vars.getGlobal('l')).toBeCloseTo(3, 5);
    });

    it('notValue inverts the operand', () => {
      runner.run([
        fn('t', 'notValue', { boolean: false }),
        fn('f', 'notValue', { boolean: true }),
      ]);
      expect(vars.getGlobal('t')).toBe(true);
      expect(vars.getGlobal('f')).toBe(false);
    });

    it('getMin / getMax accept taro num1/num2 keys (not just modu a/b aliases)', () => {
      // taro game data uses `num1` / `num2` (ParameterComponent.js:2466). Older modu
      // impl only read `a/b` or `value1/value2`, so real game scripts always saw 0.
      runner.run([
        fn('lo', 'getMin', { num1: 7, num2: 3 }),
        fn('hi', 'getMax', { num1: 7, num2: 3 }),
      ]);
      expect(vars.getGlobal('lo')).toBe(3);
      expect(vars.getGlobal('hi')).toBe(7);
    });

    it('toFixed reads `precision` (taro spec) and returns a number', () => {
      // taro returns `parseFloat(parseFloat(num).toFixed(precision))` — a number
      // (ParameterComponent.js). Older modu impl read `obj.digits` and returned a
      // string, which broke arithmetic on the result.
      runner.run([fn('n', 'toFixed', { value: 3.14159, precision: 2 })]);
      expect(vars.getGlobal('n')).toBe(3.14);
      expect(typeof vars.getGlobal('n')).toBe('number');
    });

    it('getExponent reads `power` (taro spec)', () => {
      // taro reads `text.power` (ParameterComponent.js:2486). Older modu impl
      // read `obj.exponent`, which never matched real game data.
      runner.run([fn('e', 'getExponent', { base: 2, power: 8 })]);
      expect(vars.getGlobal('e')).toBe(256);
    });
  });

  // --- B3. Additional region functions ---
  describe('B3 region functions', () => {
    it('getX/Y/Width/HeightOfRegion read flat region fields directly', () => {
      const region = { x: 10, y: 20, width: 30, height: 40 };
      vars.setGlobal('r', region, 'region');
      runner.run([
        { type: 'setVariable', variableName: 'x', value: { function: 'getXCoordinateOfRegion', region: { function: 'getVariable', variableName: 'r' } } },
        { type: 'setVariable', variableName: 'y', value: { function: 'getYCoordinateOfRegion', region: { function: 'getVariable', variableName: 'r' } } },
        { type: 'setVariable', variableName: 'w', value: { function: 'getWidthOfRegion',       region: { function: 'getVariable', variableName: 'r' } } },
        { type: 'setVariable', variableName: 'h', value: { function: 'getHeightOfRegion',      region: { function: 'getVariable', variableName: 'r' } } },
      ]);
      expect(vars.getGlobal('x')).toBe(10);
      expect(vars.getGlobal('y')).toBe(20);
      expect(vars.getGlobal('w')).toBe(30);
      expect(vars.getGlobal('h')).toBe(40);
    });

    it('getEntireMapRegion returns the map size in pixels', () => {
      runner.mapTilePx = 32;
      runner.mapData = { width: 5, height: 10, layers: [] };
      runner.run([{ type: 'setVariable', variableName: 'r', value: { function: 'getEntireMapRegion' } }]);
      expect(vars.getGlobal('r')).toEqual({ x: 0, y: 0, width: 160, height: 320 });
    });

    it('unitIsInRegion does an AABB hit-test in pixel coords', () => {
      runner.mapTilePx = 32;
      const u = new Unit('u1', { name: 'f', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
      // tile (4, 5) → (128, 160) px
      u.position.x = 4; u.position.z = 5;
      u.mount(engine.root);
      // Regions flow through the variable store (matches taro convention) so
      // _resolveValue returns the full {x,y,width,height} object reference.
      vars.setGlobal('hit',  { x: 100, y: 100, width: 100, height: 100 }, 'region');
      vars.setGlobal('miss', { x: 0,   y: 0,   width: 50,  height: 50  }, 'region');
      runner.run([
        { type: 'setVariable', variableName: 'in',  value: { function: 'unitIsInRegion', unit: 'u1', region: { function: 'getVariable', variableName: 'hit' } } },
        { type: 'setVariable', variableName: 'out', value: { function: 'unitIsInRegion', unit: 'u1', region: { function: 'getVariable', variableName: 'miss' } } },
      ]);
      expect(vars.getGlobal('in')).toBe(true);
      expect(vars.getGlobal('out')).toBe(false);
    });

    it('unitIsInRegion accepts player entities (Player extends Unit)', () => {
      // Players carry category 'player' but their position is a unit's. taro's
      // unitIsInRegion doesn't filter by category, so we must not reject them.
      runner.mapTilePx = 32;
      const p = new Player('p1', { name: 'p', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
      p.position.x = 4; p.position.z = 5; // (128, 160) px
      p.mount(engine.root);
      vars.setGlobal('hit', { x: 100, y: 100, width: 100, height: 100 }, 'region');
      runner.run([{ type: 'setVariable', variableName: 'in',
        value: { function: 'unitIsInRegion', unit: 'p1', region: { function: 'getVariable', variableName: 'hit' } } }]);
      expect(vars.getGlobal('in')).toBe(true);
    });

    it('entitiesInRegionInFrontOfEntityAtDistance excludes players (only script categories)', () => {
      // taro restricts results to entityCategories = unit/item/projectile/region/prop
      // (ActionComponent.js:8). Players have their own category and must not appear.
      runner.mapTilePx = 1;
      const u = new Unit('u1', { name: 'f', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
      u.position.x = 0; u.position.z = 0; u.rotation = 0; u.mount(engine.root);
      // Target unit sitting ahead of u1 (at y=-10)
      const target = new Unit('u2', { name: 't', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
      target.position.x = 0; target.position.z = -10; target.mount(engine.root);
      // Player sitting ahead too — should NOT appear in results
      const p = new Player('p1', { name: 'p', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
      p.position.x = 0; p.position.z = -10; p.mount(engine.root);
      runner.run([{ type: 'setVariable', variableName: 'ents',
        value: { function: 'entitiesInRegionInFrontOfEntityAtDistance', entity: 'u1', distance: 10, width: 4, height: 4 } }]);
      const ents = vars.getGlobal('ents') as string[];
      expect(ents).toContain('u2');
      expect(ents).not.toContain('p1');
    });

    it('regionInFrontOfEntityAtDistance returns box centered ahead of entity', () => {
      runner.mapTilePx = 1; // simplifies pixel math
      const u = new Unit('u1', { name: 'f', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
      u.position.x = 0; u.position.z = 0;
      u.rotation = 0; // facing "up" with the -π/2 offset → +x at angle 0 - π/2 = -π/2 → (0, -1)
      u.mount(engine.root);
      runner.run([{
        type: 'setVariable', variableName: 'r',
        value: { function: 'regionInFrontOfEntityAtDistance', entity: 'u1', distance: 10, width: 4, height: 4 },
      }]);
      const r = vars.getGlobal('r') as { x: number; y: number; width: number; height: number };
      expect(r.x).toBeCloseTo(-2, 5);  // cx = 0 + cos(-π/2)*10 ≈ 0  → x = 0 - 4/2 = -2
      expect(r.y).toBeCloseTo(-12, 5); // cy = 0 + sin(-π/2)*10 = -10 → y = -10 - 4/2 = -12
      expect(r.width).toBe(4);
      expect(r.height).toBe(4);
    });
  });

  // --- B4. Entity introspection ---
  describe('B4 entity introspection', () => {
    it('entityName / entityOpacity read from stats', () => {
      const u = new Unit('u1', { name: 'Bob', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 0.5, flip: 0, scale: 1 });
      u.mount(engine.root);
      runner.run([
        { type: 'setVariable', variableName: 'n', value: { function: 'entityName',    entity: 'u1' } },
        { type: 'setVariable', variableName: 'o', value: { function: 'entityOpacity', entity: 'u1' } },
      ]);
      expect(vars.getGlobal('n')).toBe('Bob');
      expect(vars.getGlobal('o')).toBe(0.5);
    });

    it('getEntityFromId returns the id only when the entity exists', () => {
      const u = new Unit('u1', { name: 'f', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
      u.mount(engine.root);
      runner.run([
        { type: 'setVariable', variableName: 'a', value: { function: 'getEntityFromId', string: 'u1' } },
        { type: 'setVariable', variableName: 'b', value: { function: 'getEntityFromId', string: 'nope' } },
      ]);
      expect(vars.getGlobal('a')).toBe('u1');
      expect(vars.getGlobal('b')).toBeUndefined();
    });

    it('getEntityVelocityX/Y reads through velocityProvider', () => {
      runner.velocityProvider = (eid: string) => eid === 'u1' ? { x: 3, y: -2 } : null;
      runner.run([
        { type: 'setVariable', variableName: 'vx', value: { function: 'getEntityVelocityX', entity: 'u1' } },
        { type: 'setVariable', variableName: 'vy', value: { function: 'getEntityVelocityY', entity: 'u1' } },
        { type: 'setVariable', variableName: 'gone', value: { function: 'getEntityVelocityX', entity: 'nope' } },
      ]);
      expect(vars.getGlobal('vx')).toBe(3);
      expect(vars.getGlobal('vy')).toBe(-2);
      expect(vars.getGlobal('gone')).toBe(0);
    });

    it('getEntityType returns the entity category for the entity arg', () => {
      // Karmaslayers' "press E to pick up item" iterates entitiesInRegion and
      // gates `makeUnitPickupItem` on `getEntityType(getSelectedEntity) == 'item'`.
      // Per-entity form must read `obj.entity` and return the entity's category.
      const u = new Unit('u1', { name: 'f', type: 't', health: 1, maxHealth: 1, speed: 0, ownerId: '', stateId: 'd', isHidden: false, opacity: 1, flip: 0, scale: 1 });
      u.mount(engine.root);
      const item: any = { id: 'i1', category: 'item', stats: {} };
      engine.findById = (id: string) => (id === 'u1' ? u : id === 'i1' ? item : null) as any;
      runner.run([
        { type: 'setVariable', variableName: 'utype', value: { function: 'getEntityType', entity: 'u1' } },
        { type: 'setVariable', variableName: 'itype', value: { function: 'getEntityType', entity: 'i1' } },
      ]);
      expect(vars.getGlobal('utype')).toBe('unit');
      expect(vars.getGlobal('itype')).toBe('item');
    });
  });

  // --- B5. Player functions ---
  describe('B5 player functions', () => {
    it('getPlayerByUserId scans engine players for stats.userId match', () => {
      const p = new Player('p1', { name: 'Alice', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
      (p.stats as any).userId = 'u-42';
      p.mount(engine.root);
      runner.run([{ type: 'setVariable', variableName: 'pid', value: { function: 'getPlayerByUserId', userId: 'u-42' } }]);
      expect(vars.getGlobal('pid')).toBe('p1');
    });

    it('getPlayerByUserId uses loose equality (number vs numeric string)', () => {
      // taro's GameComponent.js:214 uses == on userId, so a stats userId of `42`
      // (number) should match a script-supplied "42" (string), and vice versa.
      const p = new Player('p1', { name: 'A', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
      (p.stats as any).userId = 42;
      p.mount(engine.root);
      runner.run([{ type: 'setVariable', variableName: 'pid', value: { function: 'getPlayerByUserId', userId: '42' } }]);
      expect(vars.getGlobal('pid')).toBe('p1');
    });

    it('botPlayers / computerPlayers filter by stats.isBot / controlledBy', () => {
      const human = new Player('p1', { name: 'h', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
      const cpu   = new Player('p2', { name: 'c', controlledBy: 'computer', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
      const bot   = new Player('p3', { name: 'b', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
      (bot.stats as any).isBot = true;
      human.mount(engine.root); cpu.mount(engine.root); bot.mount(engine.root);
      runner.run([
        { type: 'setVariable', variableName: 'bots', value: { function: 'botPlayers' } },
        { type: 'setVariable', variableName: 'cpus', value: { function: 'computerPlayers' } },
      ]);
      expect(vars.getGlobal('bots')).toEqual(['p3']);
      expect(vars.getGlobal('cpus')).toEqual(['p2']);
    });

    it('playerIsCreator compares stats.userId against gameOwnerUserId', () => {
      const owner = new Player('p1', { name: 'o', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
      (owner.stats as any).userId = 'owner-id';
      const other = new Player('p2', { name: 'x', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
      (other.stats as any).userId = 'someone-else';
      owner.mount(engine.root); other.mount(engine.root);
      runner.gameOwnerUserId = 'owner-id';
      runner.run([
        { type: 'setVariable', variableName: 'o', value: { function: 'playerIsCreator', player: 'p1' } },
        { type: 'setVariable', variableName: 'x', value: { function: 'playerIsCreator', player: 'p2' } },
      ]);
      expect(vars.getGlobal('o')).toBe(true);
      expect(vars.getGlobal('x')).toBe(false);
    });

    it('lastPlayerMessage returns the per-player last chat string', () => {
      runner.setLastChatForPlayer('p1', 'hello');
      runner.run([{ type: 'setVariable', variableName: 'm', value: { function: 'lastPlayerMessage', player: 'p1' } }]);
      expect(vars.getGlobal('m')).toBe('hello');
    });
  });

  // --- B6. Camera functions ---
  describe('B6 camera functions', () => {
    it('getCamera* read from cameraStateProvider, fall back to zeros without one', () => {
      runner.run([
        { type: 'setVariable', variableName: 'p', value: { function: 'getCameraPosition' } },
        { type: 'setVariable', variableName: 'w', value: { function: 'getCameraWidth' } },
      ]);
      expect(vars.getGlobal('p')).toEqual({ x: 0, y: 0 });
      expect(vars.getGlobal('w')).toBe(0);

      runner.cameraStateProvider = () => ({ x: 100, y: 200, width: 800, height: 600, pitch: 0.5, yaw: 1.2 });
      runner.run([
        { type: 'setVariable', variableName: 'p2', value: { function: 'getCameraPosition' } },
        { type: 'setVariable', variableName: 'w2', value: { function: 'getCameraWidth'  } },
        { type: 'setVariable', variableName: 'h2', value: { function: 'getCameraHeight' } },
        { type: 'setVariable', variableName: 'pi', value: { function: 'getCameraPitch'  } },
        { type: 'setVariable', variableName: 'ya', value: { function: 'getCameraYaw'    } },
      ]);
      expect(vars.getGlobal('p2')).toEqual({ x: 100, y: 200 });
      expect(vars.getGlobal('w2')).toBe(800);
      expect(vars.getGlobal('h2')).toBe(600);
      expect(vars.getGlobal('pi')).toBeCloseTo(0.5, 5);
      expect(vars.getGlobal('ya')).toBeCloseTo(1.2, 5);
    });
  });

  // --- B7. Quest functions ---
  describe('B7 quest functions', () => {
    it('reads from player.stats.quests.active in either flat or per-game-keyed shape', () => {
      const p = new Player('p1', { name: 'q', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
      (p.stats as any).quests = {
        active:    { 'game-1': { 'q1': { progress: 2, goal: 5 } } },
        completed: { 'game-1': ['q0'] },
      };
      p.mount(engine.root);

      runner.run([
        { type: 'setVariable', variableName: 'prog',     value: { function: 'getQuestProgress', player: 'p1', questId: 'q1' } },
        { type: 'setVariable', variableName: 'active',   value: { function: 'isQuestActive',    player: 'p1', questId: 'q1' } },
        { type: 'setVariable', variableName: 'done',     value: { function: 'isQuestProgressCompleted', player: 'p1', questId: 'q1' } },
        { type: 'setVariable', variableName: 'finished', value: { function: 'isQuestCompleted', player: 'p1', questId: 'q0' } },
        { type: 'setVariable', variableName: 'all',      value: { function: 'getAllActiveQuestObjects', player: 'p1' } },
      ]);
      expect(vars.getGlobal('prog')).toBe(2);
      expect(vars.getGlobal('active')).toBe(true);
      expect(vars.getGlobal('done')).toBe(false);
      expect(vars.getGlobal('finished')).toBe(true);
      expect(vars.getGlobal('all')).toEqual({ 'game-1': { 'q1': { progress: 2, goal: 5 } } });
    });

    it('isQuestProgressCompleted returns true when progress equals goal', () => {
      const p = new Player('p1', { name: 'q', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
      (p.stats as any).quests = { active: { 'q1': { progress: 5, goal: 5 } } };
      p.mount(engine.root);
      runner.run([{ type: 'setVariable', variableName: 'd', value: { function: 'isQuestProgressCompleted', player: 'p1', questId: 'q1' } }]);
      expect(vars.getGlobal('d')).toBe(true);
    });

    it('quest readers return safe defaults when no quest data is on the player', () => {
      const p = new Player('p1', { name: 'q', controlledBy: 'human', score: 0, level: 1, coins: 0, unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '' });
      p.mount(engine.root);
      runner.run([
        { type: 'setVariable', variableName: 'a', value: { function: 'isQuestActive',    player: 'p1', questId: 'qX' } },
        { type: 'setVariable', variableName: 'p', value: { function: 'getQuestProgress', player: 'p1', questId: 'qX' } },
        { type: 'setVariable', variableName: 'all', value: { function: 'getAllActiveQuestObjects', player: 'p1' } },
      ]);
      expect(vars.getGlobal('a')).toBe(false);
      expect(vars.getGlobal('p')).toBeUndefined();
      expect(vars.getGlobal('all')).toEqual({});
    });
  });
});
