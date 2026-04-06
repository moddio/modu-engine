import * as THREE from 'three';
import { Sprite } from './Sprite';

export interface AnimationFrame {
  x: number;  // x offset in atlas (pixels)
  y: number;  // y offset in atlas
  width: number;
  height: number;
}

export interface AnimationDef {
  name: string;
  frames: AnimationFrame[];
  fps: number;
  loop: boolean;
}

export class AnimatedSprite extends Sprite {
  private _animations = new Map<string, AnimationDef>();
  private _currentAnim: AnimationDef | null = null;
  private _frameIndex = 0;
  private _elapsed = 0;
  private _playing = false;
  private _atlasWidth = 1;
  private _atlasHeight = 1;

  setAtlasSize(width: number, height: number): void {
    this._atlasWidth = width;
    this._atlasHeight = height;
  }

  addAnimation(def: AnimationDef): void {
    this._animations.set(def.name, def);
  }

  play(name: string): void {
    const anim = this._animations.get(name);
    if (!anim) return;
    if (this._currentAnim === anim && this._playing) return;
    this._currentAnim = anim;
    this._frameIndex = 0;
    this._elapsed = 0;
    this._playing = true;
    this._applyFrame();
  }

  stop(): void {
    this._playing = false;
  }

  get isPlaying(): boolean { return this._playing; }
  get currentAnimation(): string | null { return this._currentAnim?.name ?? null; }

  update(dt: number): void {
    if (!this._playing || !this._currentAnim) return;

    this._elapsed += dt;
    const frameDuration = 1000 / this._currentAnim.fps;

    if (this._elapsed >= frameDuration) {
      this._elapsed -= frameDuration;
      this._frameIndex++;

      if (this._frameIndex >= this._currentAnim.frames.length) {
        if (this._currentAnim.loop) {
          this._frameIndex = 0;
        } else {
          this._frameIndex = this._currentAnim.frames.length - 1;
          this._playing = false;
        }
      }

      this._applyFrame();
    }
  }

  /** Delegate billboard facing to base Sprite */
  override faceCamera(camera: THREE.Camera): void {
    if (!this.billboard) return;
    this.mesh.quaternion.copy(camera.quaternion);
  }

  private _applyFrame(): void {
    if (!this._currentAnim) return;
    const frame = this._currentAnim.frames[this._frameIndex];
    if (!frame) return;

    // Update UV offset and repeat for sprite sheet
    if (this.mesh.material instanceof THREE.SpriteMaterial && this.mesh.material.map) {
      const tex = this.mesh.material.map;
      tex.offset.set(frame.x / this._atlasWidth, 1 - (frame.y + frame.height) / this._atlasHeight);
      tex.repeat.set(frame.width / this._atlasWidth, frame.height / this._atlasHeight);
    }
  }
}
