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

  it('ability cast does NOT execute def.scriptName (taro editor metadata, not a cast hook)', async () => {
    // Karmaslayers and many cloned games ship abilities with `scriptName: 'playerJoinsGame'`
    // (or other unrelated trigger script ids). That field is editor metadata in taro — it
    // points at a related utility script for navigation, not a cast handler. Running it on
    // cast spawns a fresh unit every time the bound key is pressed (regression: pressing E
    // in karmaslayers re-ran playerJoinsGame and created a new unit instead of picking up).
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
                e: { keyDown: { event: 'startCasting', abilityId: 'pickupItem' } },
              },
            },
          },
        },
      },
      abilities: {
        pickupItem: { name: 'pick up item', cooldown: 0, scriptName: 'sideEffect' },
      },
      scripts: {
        ...TEST_GAME_DATA.scripts,
        sideEffect: { name: 'Side Effect', triggers: [], actions: [
          { type: 'setVariable', variableName: 'sideEffectRan', value: true },
        ]},
      },
      variables: {
        ...TEST_GAME_DATA.variables,
        sideEffectRan: { value: false, type: 'boolean' },
      },
    };
    await server.init(data as any);
    server.start();

    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Test', isMobile: false } });
    transport.client.send({ type: MessageType.PlayerKeyDown, data: { device: 'keyboard', key: 'e' } });

    expect(server.scripts.variables.getGlobal('sideEffectRan')).toBe(false);
  });

  it('ability cast runs the per-unit-type override eventScripts.startCasting', async () => {
    // Karmaslayers and most other taro games leave `data.abilities[abilityId].eventScripts`
    // empty and put the actual cast script id on the per-unit-type override at
    // `unitTypes.<typeId>.controls.unitAbilities[abilityId].eventScripts.startCasting`.
    // The override script lives under `unitTypes.<typeId>.scripts` and is indexed under
    // `unitTypes:<typeId>:<scriptId>`. Without resolving the override and the namespaced
    // index, pressing space (the canonical "interact" key) casts the ability cosmetically
    // but runs no script.
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
                space: { keyDown: { event: 'startCasting', abilityId: 'spaceAction' } },
              },
              unitAbilities: {
                spaceAction: {
                  name: 'space',
                  eventScripts: { startCasting: 'onSpace', stopCasting: '' },
                  cooldown: '',
                  cost: { unitAttributes: {}, playerAttributes: {} },
                },
              },
            },
            scripts: {
              onSpace: {
                triggers: [],
                actions: [{ type: 'setVariable', variableName: 'spacePressed', value: true }],
              },
            },
          },
        },
      },
      abilities: {
        spaceAction: {
          name: 'space',
          eventScripts: { startCasting: '', stopCasting: '' },
          cooldown: 250,
          cost: { unitAttributes: {}, playerAttributes: {} },
        },
      },
      variables: { ...TEST_GAME_DATA.variables, spacePressed: { value: false, type: 'boolean' } },
    };
    await server.init(data as any);
    server.start();

    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Test', isMobile: false } });
    transport.client.send({ type: MessageType.PlayerKeyDown, data: { device: 'keyboard', key: 'space' } });

    expect(server.scripts.variables.getGlobal('spacePressed')).toBe(true);
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

  // Inventory items must be real entities (with category, ownerId, type, attr_*)
  // mounted on engine.root so script resolvers (`getOwnerOfItem`, `getEntityAttribute`,
  // `getItemTypeOfItem`) can find them via findById. Without an entity backing the
  // inventory record, the global `unitTouchesProjectile` damage chain
  // `getOwnerOfItem(getSourceItemOfProjectile(p))` resolves to undefined and no
  // damage is applied.
  it('giveItem registers the inventory record as a findable Item entity', async () => {
    const data = JSON.parse(JSON.stringify(TEST_GAME_DATA));
    data.entities.itemTypes = {
      sword: { name: 'Sword', attributes: { dmg: { value: 25, min: 0, max: 100 } } },
    };
    data.entities.unitTypes.soldier.inventorySize = 4;
    await server.init(data);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });
    const unit = [...(server as any)._entities.values()].find((e: any) => e.category === 'unit');
    server.engine.events.emit('inventory:giveItem', [unit.id, 'sword', 1]);

    const invId = (unit as any).stats.inventory[0].id;
    const itemEnt = server.engine.findById(invId);
    expect(itemEnt).toBeTruthy();
    expect((itemEnt as any).category).toBe('item');
    expect((itemEnt as any).stats.ownerId).toBe(unit.id);
    expect((itemEnt as any).stats.type).toBe('sword');
    // Item type attributes must be mirrored to attr_* slots so getEntityAttribute
    // resolves to the configured value.
    expect((itemEnt as any).stats.attr_dmg?.value).toBe(25);
  });

  // After granting an item to a unit whose currentSlot was empty (no defaultItems),
  // currentItemId must update to the granted item's id. Karmaslayers grants the
  // starting Slingshot via giveNewItemWithQuantityToUnit in playerJoinsGame; without
  // this sync the cached null currentItemId from spawnUnit makes
  // getItemCurrentlyHeldByUnit(unit) return null, so startUsingItem(currentItemId)
  // emits item:use[null] and the click is silently dropped — items appear unusable.
  it('giveItem updates currentItemId when it lands in the held slot', async () => {
    const data = JSON.parse(JSON.stringify(TEST_GAME_DATA));
    data.entities.itemTypes = { sword: { name: 'Sword' } };
    data.entities.unitTypes.soldier.inventorySize = 4;
    await server.init(data);
    server.start();
    const updates: any[] = [];
    transport.client.onMessage((m) => {
      if (m.type === MessageType.EntityStatsUpdate) updates.push(m.data);
    });
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });
    const unit = [...(server as any)._entities.values()].find((e: any) => e.category === 'unit');
    expect((unit as any).stats.currentItemId).toBe(null);

    server.engine.events.emit('inventory:giveItem', [unit.id, 'sword', 1]);

    expect((unit as any).stats.currentItemId).not.toBe(null);
    const grantedId = (unit as any).stats.inventory[0].id;
    expect((unit as any).stats.currentItemId).toBe(grantedId);
    // Last broadcast must include currentItemId so clients refresh the held-item HUD.
    const last = updates[updates.length - 1];
    expect(last[unit.id].currentItemId).toBe(grantedId);
  });

  // Drag-to-swap inventory: dropping a slot onto another exchanges the records,
  // and broadcasts both the new inventory and (when the held slot was involved)
  // the new currentItemId so the held-item HUD/sprite refresh in lock step.
  it('PlayerSwapInventorySlot exchanges two slots and refreshes currentItemId', async () => {
    const data = JSON.parse(JSON.stringify(TEST_GAME_DATA));
    data.entities.itemTypes = { sword: { name: 'Sword' }, shield: { name: 'Shield' } };
    data.entities.unitTypes.soldier.inventorySize = 4;
    data.entities.unitTypes.soldier.defaultItems = [
      { itemTypeId: 'sword', quantity: 1 },
      { itemTypeId: 'shield', quantity: 1 },
    ];
    await server.init(data);
    server.start();
    const updates: any[] = [];
    transport.client.onMessage((m) => {
      if (m.type === MessageType.EntityStatsUpdate) updates.push(m.data);
    });
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });

    const unit = [...(server as any)._entities.values()].find((e: any) => e.category === 'unit');
    const swordId = (unit as any).stats.inventory[0].id;
    const shieldId = (unit as any).stats.inventory[1].id;
    expect((unit as any).stats.currentSlot).toBe(0);
    expect((unit as any).stats.currentItemId).toBe(swordId);

    updates.length = 0;
    transport.client.send({ type: MessageType.PlayerSwapInventorySlot, data: { from: 0, to: 1 } });

    const inv = (unit as any).stats.inventory as Array<{ id: string; type: string }>;
    expect(inv[0].id).toBe(shieldId);
    expect(inv[1].id).toBe(swordId);
    // Swapped into the held slot — currentItemId must follow.
    expect((unit as any).stats.currentItemId).toBe(shieldId);
    const last = updates[updates.length - 1];
    expect(last[unit.id].inventory).toBeTruthy();
    expect(last[unit.id].currentItemId).toBe(shieldId);
  });

  // Swapping into a slot past the dense tail: drag from a filled slot to an
  // index that doesn't yet exist in the array. The handler must pad with nulls
  // so the array length covers `to`, otherwise inv[currentSlot] reads
  // `undefined` and currentItemId silently goes null.
  it('PlayerSwapInventorySlot moves an item into an unfilled slot past array length', async () => {
    const data = JSON.parse(JSON.stringify(TEST_GAME_DATA));
    data.entities.itemTypes = { sword: { name: 'Sword' } };
    data.entities.unitTypes.soldier.inventorySize = 4;
    data.entities.unitTypes.soldier.defaultItems = [{ itemTypeId: 'sword', quantity: 1 }];
    await server.init(data);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });

    const unit = [...(server as any)._entities.values()].find((e: any) => e.category === 'unit');
    const swordId = (unit as any).stats.inventory[0].id;
    expect((unit as any).stats.inventory).toHaveLength(1);

    transport.client.send({ type: MessageType.PlayerSwapInventorySlot, data: { from: 0, to: 3 } });

    const inv = (unit as any).stats.inventory as Array<{ id?: string } | null>;
    expect(inv).toHaveLength(4);
    expect(inv[0]).toBeNull();
    expect(inv[3]?.id).toBe(swordId);
    // currentSlot was 0, which is now empty — currentItemId must clear.
    expect((unit as any).stats.currentItemId).toBeNull();
  });

  // Server-side validation: out-of-range or empty-source swaps are no-ops.
  it('PlayerSwapInventorySlot ignores out-of-range, equal, and empty-source swaps', async () => {
    const data = JSON.parse(JSON.stringify(TEST_GAME_DATA));
    data.entities.itemTypes = { sword: { name: 'Sword' } };
    data.entities.unitTypes.soldier.inventorySize = 4;
    data.entities.unitTypes.soldier.defaultItems = [{ itemTypeId: 'sword', quantity: 1 }];
    await server.init(data);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });

    const unit = [...(server as any)._entities.values()].find((e: any) => e.category === 'unit');
    const swordId = (unit as any).stats.inventory[0].id;

    // Out of range — past inventorySize.
    transport.client.send({ type: MessageType.PlayerSwapInventorySlot, data: { from: 0, to: 99 } });
    // Equal slots.
    transport.client.send({ type: MessageType.PlayerSwapInventorySlot, data: { from: 0, to: 0 } });
    // Empty source — slot 2 holds nothing.
    transport.client.send({ type: MessageType.PlayerSwapInventorySlot, data: { from: 2, to: 0 } });

    expect((unit as any).stats.inventory[0].id).toBe(swordId);
    expect((unit as any).stats.inventory).toHaveLength(1);
  });

  // Karmaslayer-style melee weapons (knife, mace) tag the item as `isGun: true` and use
  // a static-hitbox projectile (`speed: undefined`, `bulletForce: 0`, `lifeSpan: ~100ms`)
  // that detects units in a sensor area at the spawn position. Body creation used to be
  // gated behind `speed > 0`, so the hitbox spawned as a phantom data entity with no
  // collider — `unitTouchesProjectile` never fired and every melee swing was a no-op.
  // Body must be created regardless of speed so the sensor fixture's collision events
  // still fire; only `linearVelocity` should depend on speed.
  it('static-hitbox projectile (speed=0 isGun melee) gets a body so collisions fire', async () => {
    const data = JSON.parse(JSON.stringify(TEST_GAME_DATA));
    data.entities.itemTypes = {
      knife: {
        name: 'Knife',
        isGun: true,
        projectileType: 'hitbox',
        bulletForce: 0,
        bulletStartPosition: { x: 0, y: 0.5 },
      },
    };
    data.entities.projectileTypes = {
      hitbox: {
        name: 'Hitbox',
        // No `speed` — pure static hitbox.
        lifeSpan: 100,
        bodies: {
          default: {
            type: 'dynamic',
            width: 2, height: 2,
            fixtures: [{ shape: { type: 'circle' }, isSensor: true, density: 1 }],
          },
        },
      },
    };
    data.entities.unitTypes.soldier.defaultItems = [{ itemTypeId: 'knife', quantity: 1 }];
    await server.init(data);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });
    const unit = [...(server as any)._entities.values()].find((e: any) => e.category === 'unit');
    expect(unit).toBeTruthy();

    // Trigger an item:use for the held knife — `_fireGunProjectile` runs synchronously.
    server.engine.events.emit('item:use', [(unit as any).stats.currentItemId]);

    const proj = [...(server as any)._entities.values()].find((e: any) => e.category === 'projectile');
    expect(proj).toBeTruthy();
    // Critical: the projectile must have a physics body even with speed=0.
    const body = (server as any)._entityBodies.get((proj as any).id);
    expect(body).toBeTruthy();
  });

  // The melee hitbox (2-tile wide sensor) spawns at `bulletStartPosition` ahead of the
  // firing unit but its radius overlaps the firing unit's own body. Without the self-
  // collision filter in `fireUnitProjectilePair`, rapier's `collisionStart` event fires
  // for the firing unit too, routing the global `unitTouchesProjectile` damage script
  // to run with `triggeringUnit = firer`. In Karmaslayers the outer AND gate
  // (`playerIsControlledByHuman(getOwner(triggeringUnit)) == false`) then fails and the
  // entire chain no-ops — every melee swing reads as "no damage" even though the body
  // is created and the sensor IS firing.
  it('fireUnitProjectilePair skips trigger when projectile.sourceUnitId equals unit id', async () => {
    const data = JSON.parse(JSON.stringify(TEST_GAME_DATA));
    await server.init(data);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });
    const unit = [...(server as any)._entities.values()].find((e: any) => e.category === 'unit');
    expect(unit).toBeTruthy();

    // Spawn a "fired by this unit" projectile entity.
    const projId = 'prj_self_test';
    const proj = server.engine.spawn(projId);
    (proj as any).category = 'projectile';
    (proj as any).stats = { type: 'hitbox', sourceUnitId: (unit as any).id };
    (server as any)._entities.set(projId, proj);

    // Build rapier bodies for both at the same position so collisionStart fires
    // when we step physics.
    (server as any)._createEntityBody(projId, (unit as any).position.x, (unit as any).position.z, {
      bodies: { default: { type: 'dynamic', width: 2, height: 2, fixtures: [{ shape: { type: 'circle' }, isSensor: true, density: 1 }] } },
    });

    // Track which trigger contexts fire.
    const triggers: Array<{ name: string; unitId: string; projectileId?: string }> = [];
    const orig = (server.scripts as any).trigger.bind(server.scripts);
    (server.scripts as any).trigger = (name: string, ctx: any) => {
      if (name === 'unitTouchesProjectile' || name === 'entityTouchesProjectile' || name === 'entityTouchesUnit') {
        triggers.push({ name, unitId: ctx.unitId, projectileId: ctx.projectileId });
      }
      return orig(name, ctx);
    };

    // Step the physics world so the rapier collisionStart event fires for the
    // overlapping unit/projectile pair.
    (server as any)._physics.step(50);
    await new Promise(r => setTimeout(r, 30));

    // The unit-side `unitTouchesProjectile` for the firing unit must NOT fire —
    // that's the guard. (The projectile-side `entityTouchesUnit` is suppressed by
    // the same guard.)
    const selfHits = triggers.filter(t => t.unitId === (unit as any).id && t.projectileId === projId);
    expect(selfHits).toHaveLength(0);
  });

  // When a unit's `attr_health` drops to 0, the engine fires `unitAttributeBecomesZero`.
  // The death script (e.g. Karmaslayers' e6UBM4PgBF) gates on
  //   `getAttributeTypeOfAttribute(getTriggeringAttribute()) == "health"`
  // and uses `getTriggeringUnit()` to identify the dead unit for `destroyEntity`.
  // Two related bugs broke this:
  //   1. The engine fired the trigger with only `entityId` set, so
  //      `getTriggeringUnit()` (which reads `triggeredBy.unitId`) returned undefined
  //      and `destroyEntity` got a no-op id.
  //   2. The `getAttributeTypeOfAttribute` resolver only read `obj.attribute`, but the
  //      editor-authored death script passes the attribute under `obj.entity` — so the
  //      outer condition silently resolved to undefined and the destroy branch was
  //      never reached even when (1) was fixed.
  // Combined, these left mobs stuck at 0 HP, still rendered and still colliding.
  it('zeroing health fires unitAttributeBecomesZero with unitId so death scripts can destroy', async () => {
    const data = JSON.parse(JSON.stringify(TEST_GAME_DATA));
    await server.init(data);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });
    const unit = [...(server as any)._entities.values()].find((e: any) => e.category === 'unit');
    expect(unit).toBeTruthy();

    let observed: any = null;
    server.engine.events.on('unitAttributeBecomesZero', (ctx: any) => { observed = ctx; });

    // Drop health to 0. The setEntityAttribute writeAttr clamps to min and fires the trigger.
    server.engine.events.emit('setEntityAttribute', [(unit as any).id, 'health', 0]);

    expect(observed).toBeTruthy();
    // `unitId` must be present so getTriggeringUnit() resolves the dead unit.
    expect(observed.unitId).toBe((unit as any).id);
    expect(observed.attributeId).toBe('health');
  });

  // The legacy editor stores attribute references inside `entity:` (matching the
  // generic entity-targeted shape) for `getAttributeTypeOfAttribute`. Reading only
  // `obj.attribute` made every editor-authored death gate evaluate to undefined.
  it('getAttributeTypeOfAttribute accepts legacy obj.entity shape', async () => {
    const data = JSON.parse(JSON.stringify(TEST_GAME_DATA));
    await server.init(data);
    server.start();
    const runner = (server as any).scripts.actions;
    // Simulate the resolver call shape the death script uses:
    //   {function: 'getAttributeTypeOfAttribute', entity: {function: 'getTriggeringAttribute'}}
    const resolved = runner.resolveValue(
      { function: 'getAttributeTypeOfAttribute', entity: { function: 'getTriggeringAttribute' } },
      { triggeredBy: { attributeId: 'health' } },
    );
    expect(resolved).toBe('health');
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
