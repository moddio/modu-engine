import { describe, it, expect, beforeEach } from 'vitest';
import { GameLoader } from '../../engine/core/GameLoader';
import { Engine } from '../../engine/core/Engine';

describe('GameLoader', () => {
  let loader: GameLoader;

  beforeEach(() => {
    Engine.reset();
    loader = new GameLoader();
  });

  const testData = {
    version: '2.0',
    settings: {
      frameRate: 20,
      physicsEngine: 'rapier2d',
      mapBackgroundColor: '#228B22',
      camera: {
        zoom: { type: 'static', default: 3 },
        defaultPitch: 64,
        projectionMode: 'perspective',
        fov: 40,
        trackingDelay: 3,
      },
    },
    map: { width: 36, height: 36, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] },
    entities: {
      unitTypes: { 'unit1': { name: 'Soldier', width: 32, height: 32 } },
      itemTypes: { 'item1': { name: 'Sword', type: 'usable' } },
      projectileTypes: {},
      playerTypes: {},
    },
    scripts: {
      'script1': {
        name: 'On Game Start',
        triggers: ['gameStart'],
        actions: [{ type: 'setVariable', variableName: 'score', value: 0 }],
      },
    },
    variables: {
      'score': { value: 0, type: 'number' },
      'playerName': { value: 'Guest', type: 'string' },
    },
    assets: {
      images: [{ key: 'tileset', url: 'https://example.com/tileset.png' }],
      sounds: [],
      tilesets: [],
    },
  };

  it('stores game data', () => {
    loader.load(testData);
    expect(loader.gameData).not.toBeNull();
    expect(loader.gameData?.version).toBe('2.0');
  });

  it('applies frame rate setting', () => {
    loader.load(testData);
    expect(Engine.instance().clock.tickRate).toBe(20);
  });

  it('extracts camera settings', () => {
    loader.load(testData);
    expect(loader.cameraSettings).toEqual({
      zoom: { type: 'static', default: 3 },
      defaultPitch: 64,
      projectionMode: 'perspective',
      fov: 40,
      trackingDelay: 3,
    });
  });

  it('extracts map background color', () => {
    loader.load(testData);
    expect(loader.mapBackgroundColor).toBe('#228B22');
  });

  it('stores scripts as raw JSON (no execution)', () => {
    loader.load(testData);
    const scripts = loader.getScripts();
    expect(scripts).toHaveProperty('script1');
    expect(scripts['script1'].triggers).toEqual(['gameStart']);
    expect(scripts['script1'].actions).toHaveLength(1);
    expect(scripts['script1'].actions[0].type).toBe('setVariable');
  });

  it('stores and retrieves variables', () => {
    loader.load(testData);
    expect(loader.getVariable('score')).toBe(0);
    expect(loader.getVariable('playerName')).toBe('Guest');
  });

  it('provides entity type access', () => {
    loader.load(testData);
    expect(loader.getEntityTypes('unitTypes')).toHaveProperty('unit1');
    expect(loader.getEntityTypes('itemTypes')).toHaveProperty('item1');
  });

  it('extracts map data', () => {
    loader.load(testData);
    expect(loader.mapData).not.toBeNull();
    expect((loader.mapData as any)?.width).toBe(36);
  });

  it('extracts asset list', () => {
    loader.load(testData);
    expect(loader.assets?.images).toHaveLength(1);
  });

  it('allows setting variables', () => {
    loader.load(testData);
    loader.setVariable('score', 100);
    expect(loader.getVariable('score')).toBe(100);
  });

  it('resets all state', () => {
    loader.load(testData);
    loader.reset();
    expect(loader.gameData).toBeNull();
    expect(loader.getVariable('score')).toBeUndefined();
    expect(loader.cameraSettings).toBeNull();
    expect(loader.mapBackgroundColor).toBeNull();
  });
});
