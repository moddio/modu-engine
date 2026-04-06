import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalGameSession } from '../../engine/core/LocalGameSession';
import { Engine } from '../../engine/core/Engine';

describe('LocalGameSession', () => {
  let session: LocalGameSession;

  const testGameData = {
    version: '2.0',
    settings: { frameRate: 20 },
    map: { width: 10, height: 10, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] },
    entities: {
      unitTypes: {
        'soldier': { name: 'Soldier', width: 32, height: 32, speed: 5, scale: 1, attributes: { health: { value: 100, max: 100, min: 0 } } },
        'archer': { name: 'Archer', width: 32, height: 32, speed: 7, scale: 1, attributes: { health: { value: 80, max: 80, min: 0 } } },
      },
      itemTypes: {
        'sword': { name: 'Sword', maxQuantity: 1, cost: { quantity: 10 } },
        'potion': { name: 'Health Potion', maxQuantity: 5 },
      },
      projectileTypes: {
        'bullet': { name: 'Bullet', speed: 300, damage: 10, lifeSpan: 2000 },
      },
      playerTypes: {},
    },
    scripts: {
      'onStart': { name: 'On Start', triggers: ['gameStart'], actions: [{ type: 'setVariable', variableName: 'gameStarted', value: true }] },
    },
    variables: {
      'gameStarted': { value: false, type: 'boolean' },
      'score': { value: 0, type: 'number' },
    },
  };

  beforeEach(() => {
    Engine.reset();
    session = new LocalGameSession({ gameData: testGameData as any });
  });

  afterEach(() => {
    if (session.isRunning) session.stop();
    Engine.reset();
  });

  it('initializes without error', () => {
    session.init();
    expect(session.entityCount).toBe(0);
    expect(session.isRunning).toBe(false);
  });

  it('loads entity types from game data', () => {
    session.init();
    expect(session.types.typeCount('unitTypes')).toBe(2);
  });

  it('loads variables from game data', () => {
    session.init();
    expect(session.scripts.variables.getGlobal('score')).toBe(0);
    expect(session.scripts.variables.getGlobal('gameStarted')).toBe(false);
  });

  it('starts the game loop', () => {
    session.init();
    session.start();
    expect(session.isRunning).toBe(true);
  });

  it('fires gameStart trigger which runs scripts', () => {
    session.init();
    session.start();
    // The 'onStart' script sets gameStarted = true
    expect(session.scripts.variables.getGlobal('gameStarted')).toBe(true);
  });

  it('creates a local player on joinAsPlayer', () => {
    session.init();
    session.start();
    const player = session.joinAsPlayer('TestPlayer');
    expect(player).not.toBeNull();
    expect(player.stats.name).toBe('TestPlayer');
    expect(session.localPlayer).toBe(player);
  });

  it('spawns a unit for the player', () => {
    session.init();
    session.start();
    const player = session.joinAsPlayer('TestPlayer');
    // Should have spawned a unit from first unit type
    expect(player.stats.unitIds.length).toBe(1);
    expect(session.entityCount).toBeGreaterThanOrEqual(2); // player + unit
  });

  it('calls onEntityCreate callback when unit spawns', () => {
    const created: any[] = [];
    Engine.reset();
    session = new LocalGameSession({
      gameData: testGameData as any,
      onEntityCreate: (entity) => created.push(entity),
    });
    session.init();
    session.start();
    session.joinAsPlayer('Dev');
    expect(created.length).toBeGreaterThanOrEqual(1);
    expect(created[0].category).toBe('unit');
  });

  it('stops cleanly', () => {
    session.init();
    session.start();
    session.joinAsPlayer('Dev');
    session.stop();
    expect(session.isRunning).toBe(false);
    expect(session.entityCount).toBe(0);
    expect(session.localPlayer).toBeNull();
  });

  // Item pickup/drop tests
  describe('item interaction', () => {
    it('spawnItem creates an item entity and calls onEntityCreate', () => {
      const created: any[] = [];
      Engine.reset();
      session = new LocalGameSession({
        gameData: testGameData as any,
        onEntityCreate: (entity) => created.push(entity),
      });
      session.init();
      session.start();
      session.spawnItem('sword', { x: 5, z: 10 });
      const itemEntity = created.find((e) => e.category === 'item');
      expect(itemEntity).toBeDefined();
      expect(itemEntity.x).toBe(5);
      expect(itemEntity.y).toBe(10);
      expect(itemEntity.stats.name).toBe('Sword');
    });

    it('spawnItem does nothing for unknown type', () => {
      const created: any[] = [];
      Engine.reset();
      session = new LocalGameSession({
        gameData: testGameData as any,
        onEntityCreate: (entity) => created.push(entity),
      });
      session.init();
      session.start();
      const countBefore = session.entityCount;
      session.spawnItem('nonexistent', { x: 0, z: 0 });
      expect(session.entityCount).toBe(countBefore);
    });

    it('pickupItem removes item from world and assigns to unit', () => {
      const destroyed: string[] = [];
      Engine.reset();
      session = new LocalGameSession({
        gameData: testGameData as any,
        onEntityCreate: () => {},
        onEntityDestroy: (id) => destroyed.push(id),
      });
      session.init();
      session.start();
      const player = session.joinAsPlayer('Dev');
      const unitId = player.stats.selectedUnitId;

      session.spawnItem('sword', { x: 1, z: 1 });
      // Find the item entity
      let itemId = '';
      for (let i = 0; i < 100; i++) {
        const ent = session.getEntity(`entity_${i}_`);
        // iterate entities via entityCount trick
      }
      // Use a different approach: spawn and track via created callback
      Engine.reset();
      const created2: any[] = [];
      const destroyed2: string[] = [];
      session = new LocalGameSession({
        gameData: testGameData as any,
        onEntityCreate: (entity) => created2.push(entity),
        onEntityDestroy: (id) => destroyed2.push(id),
      });
      session.init();
      session.start();
      const player2 = session.joinAsPlayer('Dev');
      const unitId2 = player2.stats.selectedUnitId;
      session.spawnItem('sword', { x: 1, z: 1 });
      const itemEntity = created2.find((e) => e.category === 'item');
      expect(itemEntity).toBeDefined();

      const result = session.pickupItem(unitId2, itemEntity.id);
      expect(result).toBe(true);
      expect(destroyed2).toContain(itemEntity.id);

      const unit = session.getEntity(unitId2);
      expect(unit.stats.currentItemId).toBe(itemEntity.id);
    });

    it('pickupItem returns false for invalid ids', () => {
      session.init();
      session.start();
      expect(session.pickupItem('fake', 'also_fake')).toBe(false);
    });

    it('dropItem places item back in world at unit position', () => {
      const created: any[] = [];
      Engine.reset();
      session = new LocalGameSession({
        gameData: testGameData as any,
        onEntityCreate: (entity) => created.push(entity),
        onEntityDestroy: () => {},
      });
      session.init();
      session.start();
      const player = session.joinAsPlayer('Dev');
      const unitId = player.stats.selectedUnitId;

      session.spawnItem('potion', { x: 2, z: 3 });
      const itemEntity = created.find((e) => e.category === 'item');
      session.pickupItem(unitId, itemEntity.id);

      // Move unit to a new position
      const unit = session.getEntity(unitId);
      unit.position.x = 10;
      unit.position.z = 20;

      // Drop the item
      created.length = 0; // Clear
      session.dropItem(unitId);

      // Item should be re-created at unit position
      const droppedItem = created.find((e) => e.category === 'item');
      expect(droppedItem).toBeDefined();
      expect(droppedItem.x).toBe(10);
      expect(droppedItem.y).toBe(20);

      // Unit should no longer hold the item
      expect(unit.stats.currentItemId).toBeNull();
    });

    it('dropItem does nothing if unit has no item', () => {
      const created: any[] = [];
      Engine.reset();
      session = new LocalGameSession({
        gameData: testGameData as any,
        onEntityCreate: (entity) => created.push(entity),
      });
      session.init();
      session.start();
      const player = session.joinAsPlayer('Dev');
      const unitId = player.stats.selectedUnitId;
      created.length = 0;
      session.dropItem(unitId);
      expect(created.filter((e) => e.category === 'item').length).toBe(0);
    });
  });

  // Projectile tests
  describe('projectile spawning', () => {
    it('spawnProjectile creates a projectile entity', () => {
      const created: any[] = [];
      Engine.reset();
      session = new LocalGameSession({
        gameData: testGameData as any,
        onEntityCreate: (entity) => created.push(entity),
      });
      session.init();
      session.start();
      session.spawnProjectile('bullet', { x: 5, z: 5 }, Math.PI / 4, 'unit1');
      const proj = created.find((e) => e.category === 'projectile');
      expect(proj).toBeDefined();
      expect(proj.x).toBe(5);
      expect(proj.y).toBe(5);
    });

    it('spawnProjectile does nothing for unknown type', () => {
      Engine.reset();
      session = new LocalGameSession({
        gameData: testGameData as any,
        onEntityCreate: () => {},
      });
      session.init();
      session.start();
      const countBefore = session.entityCount;
      session.spawnProjectile('unknown', { x: 0, z: 0 }, 0, '');
      expect(session.entityCount).toBe(countBefore);
    });

    it('spawnProjectile calls onEntityUpdate during flight', async () => {
      const updates: string[] = [];
      Engine.reset();
      session = new LocalGameSession({
        gameData: testGameData as any,
        onEntityCreate: () => {},
        onEntityUpdate: (id) => updates.push(id),
        onEntityDestroy: () => {},
      });
      session.init();
      session.start();
      session.spawnProjectile('bullet', { x: 0, z: 0 }, 0, '');
      // Wait a bit for the interval to fire
      await new Promise((r) => setTimeout(r, 50));
      expect(updates.length).toBeGreaterThan(0);
    });

    it('spawnProjectile destroys projectile after lifespan', async () => {
      const destroyed: string[] = [];
      const created: any[] = [];
      Engine.reset();
      // Use a short lifespan type
      const shortLifeData = {
        ...testGameData,
        entities: {
          ...testGameData.entities,
          projectileTypes: {
            'fast': { name: 'Fast', speed: 100, damage: 5, lifeSpan: 80 },
          },
        },
      };
      session = new LocalGameSession({
        gameData: shortLifeData as any,
        onEntityCreate: (e) => created.push(e),
        onEntityUpdate: () => {},
        onEntityDestroy: (id) => destroyed.push(id),
      });
      session.init();
      session.start();
      session.spawnProjectile('fast', { x: 0, z: 0 }, 0, '');
      const proj = created.find((e) => e.category === 'projectile');
      expect(proj).toBeDefined();
      // Wait for lifespan + buffer
      await new Promise((r) => setTimeout(r, 150));
      expect(destroyed).toContain(proj.id);
    });
  });

  // Death/respawn tests
  describe('death and respawn', () => {
    it('triggers entityAttributeBecomesZero and respawns on health zero', async () => {
      const created: any[] = [];
      const destroyed: string[] = [];
      Engine.reset();
      session = new LocalGameSession({
        gameData: testGameData as any,
        onEntityCreate: (e) => created.push(e),
        onEntityDestroy: (id) => destroyed.push(id),
      });
      session.init();
      session.start();
      const player = session.joinAsPlayer('Dev');
      const unitId = player.stats.selectedUnitId;
      const unit = session.getEntity(unitId);

      // Set health to zero via the engine event
      session.engine.events.emit('setEntityAttribute', [unitId, 'health', 0]);

      // Should be "destroyed" (hidden)
      expect(destroyed).toContain(unitId);

      // Wait for respawn (3s + buffer)
      await new Promise((r) => setTimeout(r, 3200));

      // Should be re-created
      const respawned = created.filter((e) => e.id === unitId);
      expect(respawned.length).toBeGreaterThanOrEqual(2); // initial + respawn
    });
  });

  // Script action handlers
  describe('script action handlers', () => {
    it('handles createItemAtPosition action', () => {
      const created: any[] = [];
      Engine.reset();
      session = new LocalGameSession({
        gameData: testGameData as any,
        onEntityCreate: (e) => created.push(e),
      });
      session.init();
      session.start();

      session.engine.events.emit('scriptAction', ['createItemAtPosition', { itemType: 'sword', position: { x: 3, z: 4 } }, {}]);

      const item = created.find((e) => e.category === 'item');
      expect(item).toBeDefined();
      expect(item.stats.name).toBe('Sword');
    });

    it('handles createProjectileAtPosition action', () => {
      const created: any[] = [];
      Engine.reset();
      session = new LocalGameSession({
        gameData: testGameData as any,
        onEntityCreate: (e) => created.push(e),
        onEntityUpdate: () => {},
        onEntityDestroy: () => {},
      });
      session.init();
      session.start();

      session.engine.events.emit('scriptAction', ['createProjectileAtPosition', {
        projectileType: 'bullet', position: { x: 1, z: 2 }, angle: 0, sourceUnitId: 'u1',
      }, {}]);

      const proj = created.find((e) => e.category === 'projectile');
      expect(proj).toBeDefined();
    });
  });
});
