import { describe, it, expect, vi } from 'vitest';
import { AudioManager } from '../../../engine/client/audio/AudioManager';

describe('AudioManager', () => {
  it('defaults', () => {
    const am = new AudioManager();
    expect(am.soundVolume).toBe(1);
    expect(am.musicVolume).toBe(1);
    expect(am.muted).toBe(false);
    expect(am.currentMusicKey).toBeNull();
    expect(am.soundCount).toBe(0);
    expect(am.musicCount).toBe(0);
  });

  it('setSoundVolume clamps to [0,1]', () => {
    const am = new AudioManager();
    am.setSoundVolume(0.5);
    expect(am.soundVolume).toBe(0.5);
    am.setSoundVolume(-1);
    expect(am.soundVolume).toBe(0);
    am.setSoundVolume(5);
    expect(am.soundVolume).toBe(1);
  });

  it('setMusicVolume clamps to [0,1]', () => {
    const am = new AudioManager();
    am.setMusicVolume(0.3);
    expect(am.musicVolume).toBe(0.3);
    am.setMusicVolume(-0.5);
    expect(am.musicVolume).toBe(0);
    am.setMusicVolume(2);
    expect(am.musicVolume).toBe(1);
  });

  it('toggleMute flips muted state', () => {
    const am = new AudioManager();
    expect(am.muted).toBe(false);
    am.toggleMute();
    expect(am.muted).toBe(true);
    am.toggleMute();
    expect(am.muted).toBe(false);
  });

  it('emits muteChanged event on toggleMute', () => {
    const am = new AudioManager();
    const cb = vi.fn();
    am.events.on('muteChanged', cb);
    am.toggleMute();
    expect(cb).toHaveBeenCalledWith(true);
    am.toggleMute();
    expect(cb).toHaveBeenCalledWith(false);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('preloadSounds skips when Audio is undefined (Node)', async () => {
    const am = new AudioManager();
    await am.preloadSounds([{ key: 'shot', url: 'shot.mp3' }]);
    // Audio is undefined in Node, so nothing is added
    expect(am.soundCount).toBe(0);
  });

  it('preloadMusic skips when Audio is undefined (Node)', async () => {
    const am = new AudioManager();
    await am.preloadMusic([{ key: 'bgm', url: 'bgm.mp3' }]);
    expect(am.musicCount).toBe(0);
  });

  it('playSound does nothing when muted', () => {
    const am = new AudioManager();
    am.toggleMute();
    // Should not throw even with no sounds loaded
    am.playSound('nonexistent');
  });

  it('playSound does nothing for unknown key', () => {
    const am = new AudioManager();
    am.playSound('nonexistent');
    // No error thrown
  });

  it('stopMusic does nothing when no music playing', () => {
    const am = new AudioManager();
    am.stopMusic();
    expect(am.currentMusicKey).toBeNull();
  });

  it('dispose clears everything', () => {
    const am = new AudioManager();
    am.dispose();
    expect(am.soundCount).toBe(0);
    expect(am.musicCount).toBe(0);
    expect(am.currentMusicKey).toBeNull();
  });
});
