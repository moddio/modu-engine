import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameLoader } from '../../../engine/core/GameLoader';
import { Engine } from '../../../engine/core/Engine';
import type { GameData } from '../../../engine/core/GameLoader';

function makeGameData(): GameData {
  return {
    version: '2.0',
    settings: { frameRate: 30 },
    entities: {
      unitTypes: { zombie: { name: 'Zombie', health: 100 } },
      itemTypes: {},
      projectileTypes: {},
      playerTypes: {},
    },
    scripts: {
      initialize: {
        name: 'initialize',
        triggers: ['gameStart'],
        actions: [{ type: 'log', message: 'game started' }],
      },
      everySecond: {
        name: 'everySecond',
        triggers: ['interval'],
        actions: [{ type: 'log', message: 'tick' }],
      },
    },
    variables: {
      score: { value: 0, type: 'number' },
      playerName: { value: '', type: 'string' },
    },
  };
}

describe('GameLoader', () => {
  let engine: Engine;
  let loader: GameLoader;

  beforeEach(() => {
    Engine.reset();
    engine = Engine.instance();
    loader = new GameLoader(engine);
  });

  afterEach(() => { Engine.reset(); });

  it('loads game data', () => {
    loader.load(makeGameData());
    expect(loader.gameData).not.toBeNull();
    expect(loader.gameData?.version).toBe('2.0');
  });

  it('applies settings', () => {
    loader.load(makeGameData());
    expect(engine.clock.tickRate).toBe(30);
  });

  it('loads scripts as raw JSON', () => {
    loader.load(makeGameData());
    const scripts = loader.getScripts();
    expect(Object.keys(scripts)).toHaveLength(2);
    expect(scripts['initialize'].triggers).toEqual(['gameStart']);
  });

  it('rejects non-v2 data', () => {
    expect(() => loader.loadFromJSON(JSON.stringify({ version: '1.0' }))).toThrow();
  });

  it('getEntityTypes returns entity definitions', () => {
    loader.load(makeGameData());
    const units = loader.getEntityTypes('unitTypes');
    expect(units).toHaveProperty('zombie');
  });

  it('getVariable returns variable value', () => {
    loader.load(makeGameData());
    expect(loader.getVariable('score')).toBe(0);
  });

  it('reset clears state', () => {
    loader.load(makeGameData());
    loader.reset();
    expect(loader.gameData).toBeNull();
    expect(Object.keys(loader.getScripts())).toHaveLength(0);
  });
});
