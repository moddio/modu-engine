import { EventEmitter } from '../../core/events/EventEmitter';

export interface SoundDef {
  key: string;
  url: string;
  volume?: number;  // 0-100
}

export class AudioManager {
  readonly events = new EventEmitter();
  private _sounds = new Map<string, HTMLAudioElement>();
  private _music = new Map<string, HTMLAudioElement>();
  private _soundVolume = 1;
  private _musicVolume = 1;
  private _muted = false;
  private _currentMusic: HTMLAudioElement | null = null;
  private _currentMusicKey: string | null = null;

  get soundVolume(): number { return this._soundVolume; }
  get musicVolume(): number { return this._musicVolume; }
  get muted(): boolean { return this._muted; }
  get currentMusicKey(): string | null { return this._currentMusicKey; }

  /** Set sound effects volume (0-1) */
  setSoundVolume(volume: number): void {
    this._soundVolume = Math.max(0, Math.min(1, volume));
  }

  /** Set music volume (0-1) */
  setMusicVolume(volume: number): void {
    this._musicVolume = Math.max(0, Math.min(1, volume));
    if (this._currentMusic) {
      this._currentMusic.volume = this._muted ? 0 : this._musicVolume;
    }
  }

  /** Toggle mute */
  toggleMute(): void {
    this._muted = !this._muted;
    if (this._currentMusic) {
      this._currentMusic.volume = this._muted ? 0 : this._musicVolume;
    }
    this.events.emit('muteChanged', this._muted);
  }

  /** Preload sound effects from definitions */
  async preloadSounds(sounds: SoundDef[]): Promise<void> {
    for (const def of sounds) {
      if (typeof Audio === 'undefined') continue;
      try {
        const audio = new Audio(def.url);
        audio.volume = (def.volume ?? 100) / 100 * this._soundVolume;
        audio.preload = 'auto';
        this._sounds.set(def.key, audio);
      } catch {
        // Skip failed loads
      }
    }
  }

  /** Preload music tracks */
  async preloadMusic(tracks: SoundDef[]): Promise<void> {
    for (const def of tracks) {
      if (typeof Audio === 'undefined') continue;
      try {
        const audio = new Audio(def.url);
        audio.volume = (def.volume ?? 100) / 100 * this._musicVolume;
        audio.preload = 'auto';
        audio.loop = true;
        this._music.set(def.key, audio);
      } catch {
        // Skip failed loads
      }
    }
  }

  /** Play a sound effect */
  playSound(key: string, volume?: number): void {
    if (this._muted) return;
    const audio = this._sounds.get(key);
    if (!audio) return;

    // Clone for overlapping playback
    const clone = audio.cloneNode() as HTMLAudioElement;
    clone.volume = (volume ?? 1) * this._soundVolume;
    clone.play().catch(() => {});
  }

  /** Play music track */
  playMusic(key: string): void {
    this.stopMusic();
    const audio = this._music.get(key);
    if (!audio) return;

    audio.volume = this._muted ? 0 : this._musicVolume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    this._currentMusic = audio;
    this._currentMusicKey = key;
    this.events.emit('musicStarted', key);
  }

  /** Stop current music */
  stopMusic(): void {
    if (this._currentMusic) {
      this._currentMusic.pause();
      this._currentMusic.currentTime = 0;
      this.events.emit('musicStopped', this._currentMusicKey);
      this._currentMusic = null;
      this._currentMusicKey = null;
    }
  }

  /** Get number of loaded sounds */
  get soundCount(): number { return this._sounds.size; }
  get musicCount(): number { return this._music.size; }

  dispose(): void {
    this.stopMusic();
    this._sounds.clear();
    this._music.clear();
  }
}
