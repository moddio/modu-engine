import { describe, it, expect } from 'vitest';
import { GameMode } from '../../../engine/core/GameMode';

describe('GameMode', () => {
  it('defaults to singleplayer', () => {
    const gm = new GameMode();
    expect(gm.mode).toBe('singleplayer');
    expect(gm.isSinglePlayer).toBe(true);
    expect(gm.isMultiplayer).toBe(false);
  });

  it('accepts multiplayer', () => {
    const gm = new GameMode('multiplayer');
    expect(gm.isMultiplayer).toBe(true);
    expect(gm.isSinglePlayer).toBe(false);
  });

  it('setMode switches', () => {
    const gm = new GameMode();
    gm.setMode('multiplayer');
    expect(gm.isMultiplayer).toBe(true);
    gm.setMode('singleplayer');
    expect(gm.isSinglePlayer).toBe(true);
  });
});
