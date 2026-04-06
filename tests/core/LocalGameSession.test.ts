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
        'soldier': { name: 'Soldier', width: 32, height: 32, speed: 5, scale: 1, attributes: { health: { value: 100, max: 100 } } },
        'archer': { name: 'Archer', width: 32, height: 32, speed: 7, scale: 1, attributes: { health: { value: 80, max: 80 } } },
      },
      itemTypes: {},
      projectileTypes: {},
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
});
