import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SinglePlayer } from '../../../engine/client/SinglePlayer';
import { Engine } from '../../../engine/core/Engine';

describe('SinglePlayer', () => {
  let sp: SinglePlayer;

  beforeEach(() => {
    Engine.reset();
    sp = new SinglePlayer();
  });

  afterEach(() => {
    sp.destroy();
  });

  it('creates in singleplayer mode', () => {
    expect(sp.mode.isSinglePlayer).toBe(true);
  });

  it('starts and stops', () => {
    expect(sp.isRunning).toBe(false);
    sp.start();
    expect(sp.isRunning).toBe(true);
    sp.stop();
    expect(sp.isRunning).toBe(false);
  });

  it('step advances engine when running', () => {
    sp.start();
    sp.step(16);
    expect(sp.engine.clock.tick).toBe(1);
  });

  it('step does nothing when stopped', () => {
    sp.step(16);
    expect(sp.engine.clock.tick).toBe(0);
  });

  it('loads and runs scripts', () => {
    sp.start();
    sp.loadScript('test', {
      name: 'TestScript',
      triggers: ['gameStart'],
      actions: [{ type: 'setVariable', variableName: 'loaded', value: true }],
    });
    expect(sp.scripts.scriptCount).toBe(1);
    sp.scripts.trigger('gameStart');
    expect(sp.scripts.variables.getGlobal('loaded')).toBe(true);
  });

  it('destroy resets engine', () => {
    sp.start();
    sp.step(16);
    sp.destroy();
    // New instance should have fresh state
    const sp2 = new SinglePlayer();
    expect(sp2.engine.clock.tick).toBe(0);
    sp2.destroy();
  });
});
