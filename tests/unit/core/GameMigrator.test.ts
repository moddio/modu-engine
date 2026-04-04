import { describe, it, expect } from 'vitest';
import { GameMigrator } from '../../../engine/core/GameMigrator';

function makeOldGameData() {
  return {
    physicsEngine: 'planck',
    frameRate: 60,
    defaultMaxPlayers: 16,
    mapBackgroundColor: '#1a1a2e',
    data: {
      unitTypes: {
        zombie: { name: 'Zombie', cellSheet: { url: 'https://example.com/zombie.png' } },
      },
      itemTypes: {
        sword: { name: 'Sword' },
      },
      projectileTypes: {},
      playerTypes: { human: { name: 'Human' } },
      scripts: {
        initialize: {
          name: 'initialize',
          key: 'initialize',
          actions: [
            { type: 'sendChatMessage', message: { function: 'string', value: 'Game started!' } },
          ],
        },
        onDeath: {
          name: 'onDeath',
          key: 'onDeath',
          actions: [
            { type: 'destroyEntity', entity: { function: 'thisEntity' } },
          ],
        },
      },
      variables: {
        score: { dataType: 'number', value: 0 },
        playerName: { dataType: 'string', default: '' },
      },
      abilities: { dash: { name: 'Dash', cooldown: 1000 } },
      attributeTypes: { health: { value: 100, max: 100 } },
      map: { width: 64, height: 64 },
      images: [{ url: 'https://example.com/sprite.png' }],
      tilesets: [{ image: 'https://example.com/tiles.png' }],
      settings: { displayScoreboard: true },
    },
  };
}

describe('GameMigrator', () => {
  it('detects v1 format', () => {
    expect(GameMigrator.isV1(makeOldGameData())).toBe(true);
    expect(GameMigrator.isV1({ version: '2.0' })).toBe(false);
  });

  it('detects v2 format', () => {
    expect(GameMigrator.isV2({ version: '2.0' })).toBe(true);
    expect(GameMigrator.isV2(makeOldGameData())).toBe(false);
  });

  it('migrates to v2.0', () => {
    const result = GameMigrator.migrate(makeOldGameData());
    expect(result.version).toBe('2.0');
  });

  it('migrates settings', () => {
    const result = GameMigrator.migrate(makeOldGameData());
    expect(result.settings.frameRate).toBe(60);
    expect(result.settings.maxPlayers).toBe(16);
    expect(result.settings.physicsEngine).toBe('planck');
  });

  it('migrates entities', () => {
    const result = GameMigrator.migrate(makeOldGameData());
    expect(result.entities.unitTypes).toHaveProperty('zombie');
    expect(result.entities.itemTypes).toHaveProperty('sword');
    expect(result.entities.playerTypes).toHaveProperty('human');
  });

  it('transpiles scripts to JS', () => {
    const result = GameMigrator.migrate(makeOldGameData());
    expect(result.scripts.initialize.code).toContain('world.chat');
    expect(result.scripts.onDeath.code).toContain('self.destroy()');
  });

  it('migrates variables with types', () => {
    const result = GameMigrator.migrate(makeOldGameData());
    expect(result.variables.score).toEqual({ value: 0, type: 'number' });
    expect(result.variables.playerName.type).toBe('string');
  });

  it('migrates assets', () => {
    const result = GameMigrator.migrate(makeOldGameData());
    expect(result.assets.images.length).toBe(1);
    expect(result.assets.images[0].url).toContain('sprite.png');
    expect(result.assets.tilesets.length).toBe(1);
  });

  it('preserves map data', () => {
    const result = GameMigrator.migrate(makeOldGameData());
    expect(result.map).toHaveProperty('width', 64);
  });

  it('handles empty scripts gracefully', () => {
    const old = makeOldGameData();
    old.data.scripts = {};
    const result = GameMigrator.migrate(old);
    expect(Object.keys(result.scripts).length).toBe(0);
  });

  it('handles missing data sections', () => {
    const old = { data: {} } as any;
    const result = GameMigrator.migrate(old);
    expect(result.version).toBe('2.0');
    expect(Object.keys(result.entities.unitTypes).length).toBe(0);
  });
});
