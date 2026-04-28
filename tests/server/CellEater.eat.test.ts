import { describe, it, expect } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { Engine } from '../../engine/core/Engine';

// Reproduces the celleater "won't eat" bug at the engine level: a unitType whose body
// fixture has `isSensor: true` and a per-type script triggered by `unitEntersSensor`
// must (1) not physically push the entering unit (sensors don't resolve physically),
// and (2) actually run the script so the entering unit can be destroyed/eaten.
const SENSOR_TYPE = 'sensorCell';
const PREY_TYPE = 'preyUnit';
const EAT_SCRIPT = 'eatScript';

const FIXTURE: any = {
  version: '2.0',
  settings: { frameRate: 20 },
  map: { width: 10, height: 10, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] },
  entities: {
    unitTypes: {
      [SENSOR_TYPE]: {
        name: 'SensorCell',
        body: {
          type: 'dynamic', width: 40, height: 40, linearDamping: 0,
          fixtures: [{ shape: { type: 'rectangle' }, isSensor: true, density: 1 }],
        },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: {},
        controls: {},
        scripts: {
          [EAT_SCRIPT]: {
            triggers: [{ type: 'unitEntersSensor' }],
            conditions: [{ operator: '==', operandType: 'boolean' }, true, true],
            actions: [
              { type: 'destroyEntity', entity: { function: 'getTriggeringUnit' } },
            ],
          },
        },
      },
      [PREY_TYPE]: {
        name: 'Prey',
        body: { type: 'dynamic', width: 40, height: 40, linearDamping: 0 },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: {},
        controls: {},
      },
    },
    itemTypes: {}, projectileTypes: {}, playerTypes: {},
  },
  scripts: {},
  variables: {},
};

describe('Sensor unit + unitEntersSensor trigger', () => {
  it('fires the sensor owner\'s unitEntersSensor script and destroys the entering unit', async () => {
    Engine.reset();
    const transport = createInMemoryPair();
    const server = new GameServer(transport.server);
    await server.init(FIXTURE as any, FIXTURE);
    server.start();

    const sensorTypeDef = (FIXTURE.entities.unitTypes as any)[SENSOR_TYPE];
    const preyTypeDef = (FIXTURE.entities.unitTypes as any)[PREY_TYPE];

    const sensorUnit = (server as any).spawnUnit(SENSOR_TYPE, sensorTypeDef, '', { x: 5, z: 5 });
    const preyUnit = (server as any).spawnUnit(PREY_TYPE, preyTypeDef, '', { x: 5, z: 5 });

    // Two ticks so RAPIER has a chance to register the intersection (started=true)
    // and the resulting collisionStart → unitEntersSensor → destroyEntity chain runs.
    (server as any)._tick(50);
    (server as any)._tick(50);

    expect((server as any)._entities.get(preyUnit.id)).toBeUndefined();
    expect((server as any)._entities.get(sensorUnit.id)).toBeDefined();

    server.stop();
    Engine.reset();
  });

  // Celleater food pickup: items spawn with a sensor body in `bodies.dropped.fixtures[0]`
  // and `isUsedOnPickup: true` + `bonus.consume.playerAttribute`. The cell's per-type
  // `itemEntersSensor` script calls `makeUnitPickupItem`, and the engine must (a) give
  // items physics bodies (b) fire `itemEntersSensor` for unit-vs-item sensor pairs and
  // (c) apply the consume-bonus to the unit's owner so the cell's score grows.
  it('item with isUsedOnPickup grants its consume.playerAttribute to the cell\'s owner', async () => {
    Engine.reset();
    const transport = createInMemoryPair();
    const server = new GameServer(transport.server);

    const SCORE_ATTR = 'score';
    const FOOD_TYPE = 'food';
    const FIX2: any = JSON.parse(JSON.stringify(FIXTURE));
    // Cell with sensor 3D body + per-type itemEntersSensor handler.
    FIX2.entities.unitTypes[SENSOR_TYPE].bodies = {
      default: {
        width: 27.75, height: 27.75, depth: 1,
        fixtures: [{ shape: { type: 'circle' }, isSensor: true, density: 1 }],
      },
    };
    FIX2.entities.unitTypes[SENSOR_TYPE].scripts = {
      pickupScript: {
        triggers: [{ type: 'itemEntersSensor' }],
        conditions: [{ operator: '==', operandType: 'boolean' }, true, true],
        actions: [
          {
            type: 'makeUnitPickupItem',
            unit: { function: 'thisEntity' },
            item: { function: 'getTriggeringItem' },
          },
        ],
      },
    };
    FIX2.entities.itemTypes[FOOD_TYPE] = {
      name: 'Food',
      isUsedOnPickup: true,
      quantity: 1,
      bonus: { consume: { playerAttribute: { [SCORE_ATTR]: 5 }, unitAttribute: {} } },
      bodies: {
        dropped: {
          width: 13, height: 13,
          fixtures: [{ shape: { type: 'circle' }, isSensor: true, density: 1 }],
          type: 'dynamic',
        },
      },
    };
    FIX2.entities.playerTypes.humanPlayer = {
      name: 'Cells',
      attributes: { [SCORE_ATTR]: { name: 'Score', value: 10, min: 0, max: 1000000 } },
    };

    await server.init(FIX2 as any, FIX2);
    server.start();

    // Spawn a cell owned by a fake player with score=10 (assignPlayerType seeds it).
    const cellTypeDef = FIX2.entities.unitTypes[SENSOR_TYPE];
    // Manually create a player entity + assign player type so attr_score is seeded.
    const playerId = 'p1';
    const player: any = (server as any).engine.spawn(playerId);
    player.category = 'player';
    player.stats = { ownerId: '', name: 'Tester' };
    (server as any)._entities.set(playerId, player);
    (server as any).engine.events.emit('player:assignType', [playerId, 'humanPlayer']);

    const cell = (server as any).spawnUnit(SENSOR_TYPE, cellTypeDef, playerId, { x: 5, z: 5 });
    // Spawn a food item at the same position via the spawnItem event.
    (server as any).engine.events.emit('item:spawn', [FOOD_TYPE, { x: 5 * 16, y: 5 * 16 }]);

    (server as any)._tick(50);
    (server as any)._tick(50);

    const score = (player.stats as any).attr_score?.value;
    expect(score).toBe(15); // 10 starting + 5 from food

    server.stop();
    Engine.reset();
  });

  // Celleater shape: Cell and Green Virus BOTH have isSensor body fixtures, only on the
  // 3D `bodies.default.fixtures[0]` schema (the 2D `body.fixtures[0]` mirror lacks the
  // flag). The engine must detect the 3D-schema sensor flag, fire intersection events
  // between two sensor bodies, and route `unitEntersSensor` per side so the eat script
  // can pick which side gets destroyed.
  it('two sensor units (3D-schema isSensor) fire unitEntersSensor for both sides', async () => {
    Engine.reset();
    const transport = createInMemoryPair();
    const server = new GameServer(transport.server);

    const dualSensorFixture: any = JSON.parse(JSON.stringify(FIXTURE));
    // Move the isSensor flag to the 3D body schema (mirrors celleater's actual data) and
    // give both unitTypes a per-type unitEntersSensor script that destroys the entering
    // unit. Each script only matches its own parent type, so a cell-vs-cell pair fires
    // both scripts and both sides destroy the other.
    const cellLikeBody = {
      type: 'dynamic', width: 40, height: 40, linearDamping: 0,
      fixtures: [{ shape: { type: 'rectangle' }, density: 1 }],
    };
    const cellLikeBodies3d = {
      default: {
        width: 27.75, height: 27.75, depth: 1,
        fixtures: [{ shape: { type: 'circle' }, isSensor: true, density: 1 }],
      },
    };
    dualSensorFixture.entities.unitTypes[SENSOR_TYPE].body = cellLikeBody;
    dualSensorFixture.entities.unitTypes[SENSOR_TYPE].bodies = cellLikeBodies3d;
    dualSensorFixture.entities.unitTypes[PREY_TYPE].body = cellLikeBody;
    dualSensorFixture.entities.unitTypes[PREY_TYPE].bodies = cellLikeBodies3d;
    dualSensorFixture.entities.unitTypes[PREY_TYPE].scripts = {
      [`${EAT_SCRIPT}_prey`]: {
        triggers: [{ type: 'unitEntersSensor' }],
        conditions: [{ operator: '==', operandType: 'boolean' }, true, true],
        actions: [
          { type: 'destroyEntity', entity: { function: 'getTriggeringUnit' } },
        ],
      },
    };

    await server.init(dualSensorFixture as any, dualSensorFixture);
    server.start();

    const sensorTypeDef = dualSensorFixture.entities.unitTypes[SENSOR_TYPE];
    const preyTypeDef = dualSensorFixture.entities.unitTypes[PREY_TYPE];

    const a = (server as any).spawnUnit(SENSOR_TYPE, sensorTypeDef, '', { x: 5, z: 5 });
    const b = (server as any).spawnUnit(PREY_TYPE, preyTypeDef, '', { x: 5, z: 5 });

    (server as any)._tick(50);
    (server as any)._tick(50);

    // Both scripts fire on the started intersection — each entity's per-type script
    // destroys the other. Both sides should be gone.
    expect((server as any)._entities.get(a.id)).toBeUndefined();
    expect((server as any)._entities.get(b.id)).toBeUndefined();

    server.stop();
    Engine.reset();
  });
});
