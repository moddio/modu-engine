import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { Engine } from '../../engine/core/Engine';

const TEST_GAME_DATA = {
  version: '2.0',
  settings: { frameRate: 20 },
  map: { width: 10, height: 10, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] },
  entities: {
    unitTypes: {
      'soldier': {
        name: 'Soldier',
        body: { type: 'dynamic', width: 40, height: 40, linearDamping: 5 },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: { health: { value: 100, max: 100 }, speed: { value: 40 } },
        controls: { movementMethod: 'velocity', movementType: 'wasd' },
      },
    },
    itemTypes: {},
    projectileTypes: {},
    playerTypes: {},
  },
  scripts: {
    'onStart': { name: 'On Start', triggers: ['gameStart'], actions: [
      { type: 'setVariable', variableName: 'gameRunning', value: true },
    ]},
  },
  variables: { gameRunning: { value: false, type: 'boolean' } },
};

describe('GameServer', () => {
  let server: GameServer;
  let transport: ReturnType<typeof createInMemoryPair>;

  beforeEach(() => {
    Engine.reset();
    transport = createInMemoryPair();
    server = new GameServer(transport.server);
  });

  afterEach(() => {
    server.stop();
    Engine.reset();
  });

  it('initializes from game data', async () => {
    await server.init(TEST_GAME_DATA as any);
    expect(server.isRunning).toBe(false);
    expect(server.entityCount).toBe(0);
  });

  it('starts the tick loop and fires gameStart', async () => {
    await server.init(TEST_GAME_DATA as any);
    server.start();
    expect(server.isRunning).toBe(true);
    expect(server.scripts.variables.getGlobal('gameRunning')).toBe(true);
  });

  it('creates a player on joinGame', async () => {
    await server.init(TEST_GAME_DATA as any);
    server.start();

    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Test', isMobile: false } });

    expect(server.playerCount).toBe(1);
  });

  it('streams entity create to client on join', async () => {
    await server.init(TEST_GAME_DATA as any);
    server.start();

    const messages: any[] = [];
    transport.client.onMessage((msg) => messages.push(msg));
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Test', isMobile: false } });

    const createMsgs = messages.filter(m => m.type === MessageType.EntityCreate);
    expect(createMsgs.length).toBeGreaterThan(0);
    expect(createMsgs[0].data.classId).toBe('unit');
  });

  it('responds to ping with pong', async () => {
    await server.init(TEST_GAME_DATA as any);
    server.start();

    const messages: any[] = [];
    transport.client.onMessage((msg) => messages.push(msg));
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Test', isMobile: false } });
    transport.client.send({ type: MessageType.Ping, data: { sentAt: Date.now() } });

    const pongs = messages.filter(m => m.type === MessageType.Pong);
    expect(pongs.length).toBe(1);
  });

  it('stops cleanly', async () => {
    await server.init(TEST_GAME_DATA as any);
    server.start();
    server.stop();
    expect(server.isRunning).toBe(false);
    expect(server.entityCount).toBe(0);
  });

  it('keydown fires the per-entity-type ability script bound to that key', async () => {
    // Game data: a unit type whose `b` keyDown is bound to an isEntityScript named "onB"
    // that lives under the type's own .scripts block (the standard taro shape).
    const data = {
      ...TEST_GAME_DATA,
      entities: {
        ...TEST_GAME_DATA.entities,
        unitTypes: {
          'soldier': {
            ...TEST_GAME_DATA.entities.unitTypes.soldier,
            controls: {
              ...((TEST_GAME_DATA.entities.unitTypes.soldier as any).controls ?? {}),
              abilities: {
                b: { keyDown: { scriptName: 'onB', isEntityScript: true } },
              },
            },
            scripts: {
              onB: {
                triggers: [],
                actions: [{ type: 'setVariable', variableName: 'bPressed', value: true }],
              },
            },
          },
        },
      },
      variables: { ...TEST_GAME_DATA.variables, bPressed: { value: false, type: 'boolean' } },
    };

    await server.init(data as any);
    server.start();

    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Test', isMobile: false } });
    // Send the keydown that should fire the per-entity script.
    transport.client.send({ type: MessageType.PlayerKeyDown, data: { device: 'keyboard', key: 'b' } });

    expect(server.scripts.variables.getGlobal('bPressed')).toBe(true);
  });

  it('keydown to ability binding emits ability:cast', async () => {
    const data = {
      ...TEST_GAME_DATA,
      entities: {
        ...TEST_GAME_DATA.entities,
        unitTypes: {
          'soldier': {
            ...TEST_GAME_DATA.entities.unitTypes.soldier,
            controls: {
              ...((TEST_GAME_DATA.entities.unitTypes.soldier as any).controls ?? {}),
              abilities: {
                e: { keyDown: { event: 'startCasting', abilityId: 'fireball' } },
              },
            },
          },
        },
      },
    };
    await server.init(data as any);
    server.start();

    let castedWith: unknown[] = [];
    server.engine.events.on('ability:cast', (...args: unknown[]) => { castedWith = args; });

    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Test', isMobile: false } });
    transport.client.send({ type: MessageType.PlayerKeyDown, data: { device: 'keyboard', key: 'e' } });

    expect(castedWith[1]).toBe('fireball');
  });

  it('setEntityVariable mutation rides EntityStatsUpdate to clients', async () => {
    await server.init(TEST_GAME_DATA as any);
    server.start();

    const messages: any[] = [];
    transport.client.onMessage((msg) => messages.push(msg));
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Test', isMobile: false } });

    // Find the spawned unit's id from the EntityCreate broadcast.
    const createMsg = messages.find((m) => m.type === MessageType.EntityCreate && m.data.classId === 'unit');
    expect(createMsg).toBeTruthy();
    const entityId = createMsg.data.entityId;

    // Drain the messages buffer, then mutate via the engine event (the same path ActionRunner uses).
    messages.length = 0;
    server.engine.events.emit('setEntityVariable', [entityId, 'mood', 'angry']);

    const update = messages.find((m) => m.type === MessageType.EntityStatsUpdate
      && m.data?.[entityId]?.variables?.mood === 'angry');
    expect(update).toBeTruthy();

    // Mirror onto entity.stats.variables for late-joiner EntityCreate replays.
    const entity = (server as any)._entities.get(entityId);
    expect(entity?.stats?.variables?.mood).toBe('angry');
  });

  // Taro stores a unitType's `defaultItems` as `Array<{ key, name, value }>` where `key`
  // is the itemType id. spawnUnit must install one inventory entry per default item or the
  // HUD's slot bar stays empty (real symptom: F0mB1BW05 spawned with no weapons).
  it('spawnUnit populates inventory from typeDef.defaultItems (taro array shape)', async () => {
    const data = JSON.parse(JSON.stringify(TEST_GAME_DATA));
    data.entities.itemTypes = {
      sword: { name: 'Sword', cellSheet: { url: '' } },
      plasmaPistol: { name: 'Plasma Pistol', cellSheet: { url: '' } },
    };
    data.entities.unitTypes.soldier.inventorySize = 4;
    data.entities.unitTypes.soldier.defaultItems = [
      { name: 'Sword', value: 'Sword', key: 'sword' },
      { name: 'Plasma Pistol', value: 'Plasma Pistol', key: 'plasmaPistol' },
    ];
    await server.init(data);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });

    // The spawned unit is the only unit entity in the engine.
    const unit = [...(server as any)._entities.values()].find((e: any) => e.category === 'unit');
    expect(unit).toBeTruthy();
    const inv = (unit as any).stats.inventory as Array<{ id: string; type: string; quantity: number }>;
    expect(inv).toHaveLength(2);
    expect(inv[0].type).toBe('sword');
    expect(inv[1].type).toBe('plasmaPistol');
    expect(inv[0].quantity).toBe(1);
    expect((unit as any).stats.inventorySize).toBe(4);
    expect((unit as any).stats.currentSlot).toBe(0);
    expect((unit as any).stats.currentItemId).toBe(inv[0].id);
  });

  // _onJoinGame auto-spawns a "placeholder" unit at map center so the camera has something
  // to follow before scripts run. When playerJoinsGame later calls playerCameraTrackUnit to
  // switch to a script-spawned unit (F0mB1BW05's purpleFighter at the team spawn region),
  // the placeholder must be destroyed — otherwise it stays as a ghost in the middle of the map.
  it('camera:trackUnit destroys the auto-spawned placeholder when switching to a different unit', async () => {
    await server.init(TEST_GAME_DATA as any);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });

    const placeholderId = [...(server as any)._entities.values()].find((e: any) => e.category === 'unit').id;
    expect((server as any)._entities.get(placeholderId)).toBeTruthy();

    const playerId = [...(server as any)._entities.values()].find((e: any) => e.category === 'player').id;
    server.engine.events.emit('camera:trackUnit', [playerId, 'real_unit_id']);

    // Placeholder gone, _players[unitId] retargeted.
    expect((server as any)._entities.get(placeholderId)).toBeUndefined();
    const pd = [...(server as any)._players.values()].find((d: any) => d.player.id === playerId);
    expect(pd?.unitId).toBe('real_unit_id');
    expect(pd?.placeholderUnitId).toBeUndefined();
  });

  // If a script calls playerCameraTrackUnit pointing back at the placeholder itself
  // (e.g. an idempotent re-track), don't destroy it.
  it('camera:trackUnit pointing at the placeholder does not destroy it', async () => {
    await server.init(TEST_GAME_DATA as any);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });

    const playerId = [...(server as any)._entities.values()].find((e: any) => e.category === 'player').id;
    const placeholderId = [...(server as any)._players.values()].find((d: any) => d.player.id === playerId).placeholderUnitId;
    expect(placeholderId).toBeTruthy();

    server.engine.events.emit('camera:trackUnit', [playerId, placeholderId]);
    expect((server as any)._entities.get(placeholderId)).toBeTruthy();
  });

  // Forward-compat: older games may carry a record-of-{itemTypeId} shape; accept it too.
  it('spawnUnit accepts legacy defaultItems record-of-itemTypeId shape', async () => {
    const data = JSON.parse(JSON.stringify(TEST_GAME_DATA));
    data.entities.itemTypes = { sword: { name: 'Sword' } };
    data.entities.unitTypes.soldier.inventorySize = 2;
    data.entities.unitTypes.soldier.defaultItems = {
      slot0: { itemTypeId: 'sword', quantity: 3 },
    };
    await server.init(data);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });

    const unit = [...(server as any)._entities.values()].find((e: any) => e.category === 'unit');
    const inv = (unit as any).stats.inventory as Array<{ type: string; quantity: number }>;
    expect(inv).toHaveLength(1);
    expect(inv[0].type).toBe('sword');
    expect(inv[0].quantity).toBe(3);
  });
});
